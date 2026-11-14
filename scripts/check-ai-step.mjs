// Checks the AI step without calling the Anthropic API:
// fetches the official sources, then runs RegChain's own checks on drafts
// from a stand-in client, one with a made-up quote and one without.
// Usage: node scripts/check-ai-step.mjs [--save]
//   --save writes the passing test draft as the recorded result (for UI testing only).

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSources, diffLines, cacheDir } from "../regchain-ai/sources.mjs";
import { draftChange, verifyDraft, MODEL } from "../regchain-ai/analyze.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rule = { requirement: "GB/IMP_LABELING", effective: "2026-04-28" };

const sources = await loadSources(root, { refresh: true });
for (const source of sources) {
  assert.ok(source.text.length > 200, `${source.id}: text missing (${source.fetchError ?? "empty"})`);
  assert.match(source.hash, /^[0-9a-f]{64}$/);
  console.log(`ok  ${source.id}: ${source.text.length} characters, ${source.origin}, version ${source.validFrom}`);
}
const before = sources.find(source => source.role === "before");
const after = sources.find(source => source.role === "after");
assert.notEqual(before.hash, after.hash, "the two versions should differ");
const diff = diffLines(before.text, after.text);
assert.ok(diff.added > 0 && diff.removed > 0);
console.log(`ok  regulation 46 changed: ${diff.added} lines added, ${diff.removed} removed`);

// Real phrases taken from the fetched text, so the test never stores legal text.
function phraseFrom(text, words = 12) {
  const line = text.split("\n").filter(item => item.split(" ").length >= words).sort((a, b) => b.length - a.length)[0];
  assert.ok(line, "no long line found");
  return line.split(" ").slice(0, words).join(" ");
}
const schedule = sources.find(source => source.id === "sch14-para6");
const realClaims = [
  { statement: "The new regulation 46 sets the labelling rules.", sourceId: after.id, quote: phraseFrom(after.text) },
  { statement: "Schedule 14 keeps the earlier rules for some products.", sourceId: schedule.id, quote: phraseFrom(schedule.text, 8) },
];
const madeUp = { statement: "A rule the sources never state.", sourceId: after.id, quote: "This sentence was invented and appears in no official source at all." };

function standIn(draft) {
  return {
    beta: {
      messages: {
        async create(params) {
          assert.equal(params.model, MODEL);
          assert.equal(params.output_config.format.type, "json_schema");
          assert.deepEqual(params.output_config.format.schema.properties.claims.items.properties.sourceId.enum, sources.map(source => source.id));
          return { model: "test stand-in (no API call)", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(draft) }] };
        },
      },
    },
  };
}

const base = {
  status: "material",
  summary: "Test draft.",
  effectiveDate: "2026-04-28",
  scope: "UK clinical trials",
  transition: { applies: true, conditions: ["Test condition"] },
  requirementStatement: "Test requirement statement.",
  proposedRequirement: "Test instruction.",
  uncertainties: [],
};

const bad = await draftChange(sources, { client: standIn({ ...base, claims: [...realClaims, madeUp] }) });
const badCheck = verifyDraft(bad.draft, sources, rule);
assert.deepEqual(badCheck.claims.map(claim => claim.found), [true, true, false]);
assert.equal(badCheck.checks.find(check => check.id === "quotes").ok, false);
assert.equal(badCheck.verified, false);
console.log("ok  a made-up quote is caught and blocks approval");

const wrongDate = verifyDraft({ ...base, effectiveDate: "2026-05-05", claims: realClaims }, sources, rule);
assert.equal(wrongDate.checks.find(check => check.id === "date").ok, false);
console.log("ok  a wrong effective date is caught");

const good = await draftChange(sources, { client: standIn({ ...base, claims: realClaims }) });
const goodCheck = verifyDraft(good.draft, sources, rule);
assert.equal(goodCheck.verified, true, JSON.stringify(goodCheck.checks));
console.log("ok  a draft with real quotes and the right date passes");

if (process.argv.includes("--save")) {
  const dir = cacheDir(root);
  await mkdir(dir, { recursive: true });
  const result = {
    at: new Date().toISOString(),
    model: good.model,
    rule,
    sources: sources.map(({ text, ...meta }) => ({ ...meta, characters: text.length })),
    diff,
    draft: { ...good.draft, claims: [...realClaims, madeUp] },
    verification: badCheck,
    usage: null,
  };
  await writeFile(join(dir, "analysis-latest.json"), JSON.stringify(result, null, 2));
  console.log(`saved a test result to ${join(dir, "analysis-latest.json")}`);
}
console.log("All AI step checks passed.");
