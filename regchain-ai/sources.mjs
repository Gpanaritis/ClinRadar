// Official sources for the UK IMP labeling case.
// The text is fetched from legislation.gov.uk and GOV.UK at run time and is
// never stored in the repository. A local cache keeps the last good copy so
// the demo still works without internet.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LEG = "https://www.legislation.gov.uk/uksi/2004/1031";
const GUIDANCE_PATH = "/guidance/clinical-trials-for-medicines-clinical-trials-regulations-transitional-arrangements";

export const SOURCES = [
  {
    id: "reg46-before",
    role: "before",
    title: "Regulation 46, version in force on 27 April 2026",
    authority: "UK Legislation",
    kind: "legislation",
    url: `${LEG}/regulation/46/2026-04-27`,
  },
  {
    id: "reg46-after",
    role: "after",
    title: "Regulation 46, version in force from 28 April 2026",
    authority: "UK Legislation",
    kind: "legislation",
    url: `${LEG}/regulation/46/2026-04-28`,
  },
  {
    id: "sch14-para6",
    role: "supporting",
    title: "Schedule 14, paragraph 6 (labelling transition)",
    authority: "UK Legislation",
    kind: "legislation",
    url: `${LEG}/schedule/14/paragraph/6/2026-04-28`,
  },
  {
    id: "mhra-labelling-transition",
    role: "supporting",
    title: "MHRA guidance: transitional arrangements for labelling of IMPs",
    authority: "MHRA",
    kind: "govuk",
    url: `https://www.gov.uk${GUIDANCE_PATH}#transitional-arrangements-for-labelling-of-investigational-medicinal-products`,
    api: `https://www.gov.uk/api/content${GUIDANCE_PATH}`,
    anchor: "transitional-arrangements-for-labelling-of-investigational-medicinal-products",
  },
];

const USER_AGENT = "RegChain-prototype/0.1 (hackathon demo)";

export function cacheDir(root) {
  return process.env.REGCHAIN_CACHE_DIR || join(root, ".regchain-cache");
}

// Same normalisation for source text and quotes, so a quote copied from the
// source matches even when spacing, curly quotes or dashes differ.
export function normalise(text) {
  return String(text ?? "")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[  -​ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprint(text) {
  return createHash("sha256").update(normalise(text), "utf8").digest("hex");
}

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function cleanLines(text) {
  return decodeEntities(text)
    .split("\n")
    .map(line => line.replace(/[ \t\r\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// legislation.gov.uk data.xml (CLML): keep the provision, drop metadata and commentary.
export function legislationText(xml) {
  const start = xml.search(/<(Body|Schedules)[\s>]/);
  const end = Math.max(xml.lastIndexOf("</Body>"), xml.lastIndexOf("</Schedules>"));
  if (start < 0 || end < start) throw new Error("No provision text found in the legislation XML");
  const head = xml.slice(start, start + 600);
  const from = /RestrictStartDate="([^"]+)"/.exec(head)?.[1] ?? null;
  const until = /RestrictEndDate="([^"]+)"/.exec(head)?.[1] ?? null;
  const body = xml
    .slice(start, end)
    .replace(/<Commentary\b[\s\S]*?<\/Commentary>/g, "")
    .replace(/<CommentaryRef\b[^>]*\/>/g, "")
    .replace(/<Pnumber\b[^>]*>([\s\S]*?)<\/Pnumber>/g, "\n($1) ")
    .replace(/<(P\d?group|P\d|P\dpara|Title|Text|BlockText|ListItem|Para|Tabular)\b[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, " ");
  return { text: cleanLines(body), validFrom: from, validUntil: until };
}

// GOV.UK Content API: keep one section of the guidance page, by its heading id.
export function govukSection(json, anchor) {
  const html = String(json?.details?.body ?? "");
  const start = html.search(new RegExp(`<h2[^>]*id="${anchor}"`));
  if (start < 0) throw new Error(`Section ${anchor} not found on the GOV.UK page`);
  const next = html.indexOf("<h2", start + 4);
  const section = html
    .slice(start, next < 0 ? html.length : next)
    .replace(/<(h\d|p|li|tr|div|br)\b[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, " ");
  return { text: cleanLines(section), validFrom: json.public_updated_at ?? null, validUntil: null };
}

async function download(url, accept) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: accept },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).host}`);
  return response;
}

async function fetchOne(source) {
  if (source.kind === "govuk") {
    const json = await (await download(source.api, "application/json")).json();
    return govukSection(json, source.anchor);
  }
  const xml = await (await download(`${source.url}/data.xml`, "application/xml")).text();
  return legislationText(xml);
}

async function readCached(dir, id) {
  try {
    return JSON.parse(await readFile(join(dir, `source-${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

// Returns every source with its text, fingerprint and where it came from.
// A failed download falls back to the last cached copy and says so.
export async function loadSources(root, { refresh = true } = {}) {
  const dir = cacheDir(root);
  await mkdir(dir, { recursive: true });
  return Promise.all(
    SOURCES.map(async source => {
      const cached = await readCached(dir, source.id);
      if (!refresh && cached) return { ...cached, origin: "cache" };
      try {
        const { text, validFrom, validUntil } = await fetchOne(source);
        if (!text) throw new Error("Empty text");
        const record = {
          ...source,
          text,
          validFrom,
          validUntil,
          hash: fingerprint(text),
          retrievedAt: new Date().toISOString(),
        };
        await writeFile(join(dir, `source-${source.id}.json`), JSON.stringify(record, null, 2));
        return { ...record, origin: "live" };
      } catch (error) {
        if (cached) return { ...cached, origin: "cache", fetchError: error.message };
        return { ...source, text: "", hash: null, retrievedAt: null, origin: "missing", fetchError: error.message };
      }
    }),
  );
}

// Line-level comparison of the two versions (longest common subsequence).
export function diffLines(beforeText, afterText) {
  const a = beforeText.split("\n");
  const b = afterText.split("\n");
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = normalise(a[i]) === normalise(b[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (normalise(a[i]) === normalise(b[j])) {
      lines.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ type: "removed", text: a[i++] });
    } else {
      lines.push({ type: "added", text: b[j++] });
    }
  }
  while (i < a.length) lines.push({ type: "removed", text: a[i++] });
  while (j < b.length) lines.push({ type: "added", text: b[j++] });
  return {
    added: lines.filter(line => line.type === "added").length,
    removed: lines.filter(line => line.type === "removed").length,
    lines,
  };
}
