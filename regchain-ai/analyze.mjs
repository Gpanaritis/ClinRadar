// AI step for the UK IMP labeling case: Claude reads the two official
// versions of regulation 46 and the supporting sources, and drafts the change.
// RegChain then checks the draft itself: every quote must appear in the
// source it cites, and the effective date must match the recorded rule.

import { normalise } from "./sources.mjs";

export const MODEL = "claude-opus-5-5";

const SYSTEM = `You support a Regulatory Affairs expert in a clinical supply team.
You compare two official versions of a UK regulation, with supporting official sources, and draft what changed for the company's country record.

Rules:
- Use only the sources provided. Do not rely on memory of the law.
- Every claim must carry one exact quote copied character for character from a single source, with that source's id. Quote a full phrase of at least eight words that proves the claim on its own.
- Write dates as YYYY-MM-DD.
- When the sources do not settle something, put it in uncertainties instead of guessing.
- You draft; a named expert decides. Do not state that anything is approved.`;

const TASK = `Draft the change for the company requirement GB/IMP_LABELING:
1. status: "material" if the legal obligations changed, "cosmetic" if only wording or layout changed, "no_change" if nothing changed.
2. summary: two or three plain sentences on what changed.
3. effectiveDate: the date the new version applies.
4. scope: who and what the new rules apply to.
5. transition: whether the earlier rules can continue for some products, and each condition for that.
6. requirementStatement: one sentence stating the requirement as the company's country record should publish it.
7. proposedRequirement: the operational instruction for the supply team, in two to four sentences.
8. claims: between four and eight claims that support the points above, each with its quote and source id.
9. uncertainties: what an expert still needs to confirm.`;

function schemaFor(sourceIds) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "summary", "effectiveDate", "scope", "transition", "requirementStatement", "proposedRequirement", "claims", "uncertainties"],
    properties: {
      status: { type: "string", enum: ["material", "cosmetic", "no_change"] },
      summary: { type: "string" },
      effectiveDate: { type: "string" },
      scope: { type: "string" },
      transition: {
        type: "object",
        additionalProperties: false,
        required: ["applies", "conditions"],
        properties: {
          applies: { type: "boolean" },
          conditions: { type: "array", items: { type: "string" } },
        },
      },
      requirementStatement: { type: "string" },
      proposedRequirement: { type: "string" },
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["statement", "sourceId", "quote"],
          properties: {
            statement: { type: "string" },
            sourceId: { type: "string", enum: sourceIds },
            quote: { type: "string" },
          },
        },
      },
      uncertainties: { type: "array", items: { type: "string" } },
    },
  };
}

function sourceBlock(source) {
  return [
    `<source id="${source.id}" role="${source.role}">`,
    `Title: ${source.title}`,
    `Authority: ${source.authority}`,
    `Version: ${source.validFrom ?? "unknown"}${source.validUntil ? ` until ${source.validUntil}` : ""}`,
    `URL: ${source.url}`,
    "",
    source.text,
    "</source>",
  ].join("\n");
}

async function defaultClient() {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic();
}

// Calls Claude once. `client` can be passed in for tests.
export async function draftChange(sources, { client } = {}) {
  const usable = sources.filter(source => source.text);
  if (!usable.some(source => source.role === "before") || !usable.some(source => source.role === "after")) {
    throw new Error("Both versions of regulation 46 are needed. Check the internet connection and fetch the sources again.");
  }
  const api = client ?? (await defaultClient());
  const response = await api.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: schemaFor(usable.map(source => source.id)) },
    },
    system: SYSTEM,
    messages: [{ role: "user", content: `${usable.map(sourceBlock).join("\n\n")}\n\n${TASK}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (response.stop_reason === "max_tokens") throw new Error("The model's answer was cut off. Try again.");
  const text = response.content.filter(block => block.type === "text").map(block => block.text).join("");
  let draft;
  try {
    draft = JSON.parse(text);
  } catch {
    throw new Error("The model's answer was not valid JSON. Try again.");
  }
  return { draft, model: response.model, usage: response.usage ?? null };
}

// RegChain's own checks on the draft. Nothing here trusts the model.
export function verifyDraft(draft, sources, rule) {
  const byId = new Map(sources.map(source => [source.id, normalise(source.text)]));
  const claims = (Array.isArray(draft?.claims) ? draft.claims : []).map(claim => {
    const quote = normalise(claim?.quote);
    const sourceText = byId.get(claim?.sourceId);
    let found = false;
    let reason = "";
    if (!sourceText) reason = "Cited source is not one of the fetched sources.";
    else if (quote.split(" ").length < 5) reason = "Quote is too short to prove anything.";
    else if (!sourceText.includes(quote)) reason = "These words do not appear in the cited source.";
    else found = true;
    return { statement: String(claim?.statement ?? ""), sourceId: String(claim?.sourceId ?? ""), quote: String(claim?.quote ?? ""), found, reason };
  });
  const before = sources.find(source => source.role === "before");
  const after = sources.find(source => source.role === "after");
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const missingQuotes = claims.filter(claim => !claim.found).length;
  const checks = [
    {
      id: "sources",
      label: "Both official versions were read",
      ok: Boolean(before?.hash && after?.hash),
      detail: before?.hash && after?.hash ? "Regulation 46 before and after 28 April 2026" : "A version of regulation 46 is missing",
    },
    {
      id: "quotes",
      label: "Every quote appears in its source",
      ok: claims.length > 0 && missingQuotes === 0,
      detail: claims.length === 0 ? "No claims returned" : missingQuotes === 0 ? `${claims.length} of ${claims.length} quotes found` : `${missingQuotes} of ${claims.length} quotes not found`,
    },
    {
      id: "date",
      label: "Effective date matches the recorded rule",
      ok: datePattern.test(draft?.effectiveDate ?? "") && draft.effectiveDate === rule.effective,
      detail: `AI: ${draft?.effectiveDate || "none"} · recorded rule: ${rule.effective}`,
    },
    {
      id: "status",
      label: "Change status agrees with the source comparison",
      ok: before?.hash !== after?.hash ? draft?.status === "material" || draft?.status === "cosmetic" : draft?.status === "no_change",
      detail: `Text ${before?.hash !== after?.hash ? "changed" : "unchanged"} · AI says ${draft?.status ?? "nothing"}`,
    },
  ];
  return { claims, checks, verified: checks.every(check => check.ok) };
}
