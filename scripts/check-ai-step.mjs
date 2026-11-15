// Checks the AI step without calling the Google API:
// fetches the official UK sources, reads the fictional Spain note, then runs
// RegChain's own checks on drafts from a stand-in client, with and without errors.
// Usage: node scripts/check-ai-step.mjs [--save]
//   --save writes a UK test result with one made-up quote (for UI testing only).
//   --save-es writes a passing Spain test result (for UI testing only).

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSources, diffLines, cacheDir } from "../regchain-ai/sources.mjs";
import { draftChange, verifyDraft, MODEL } from "../regchain-ai/analyze.mjs";
import { loadSpainSources, loadSpainScenario, spainRule } from "../regchain-ai/spain.mjs";

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
    models: {
      async generateContent(params) {
        assert.equal(params.model, MODEL);
        assert.equal(params.config.responseMimeType, "application/json");
        assert.deepEqual(params.config.responseJsonSchema.properties.claims.items.properties.sourceId.enum, sources.map(source => source.id));
        return { modelVersion: "test stand-in (no API call)", candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify(draft) }] } }] };
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

// Spain case (fictional): the note in Spanish and the current specification, read from the demo file.
const esSources = await loadSpainSources(root);
const esRule = await spainRule(root);
const scenario = await loadSpainScenario(root);
const notice = esSources.find(source => source.id === "es-notice");
for (const item of scenario.case.evidence) assert.ok(notice.text.includes(item.excerpt), `${item.id} is not in the note`);
console.log(`ok  Spain: ${scenario.case.evidence.length} evidence excerpts appear in the note`);
const esBase = {
  status: "material",
  summary: "Test draft.",
  effectiveDate: "2027-03-01",
  scope: "IMP shipments to Spanish sites",
  transition: { applies: true, conditions: ["Dispatched before 1 Mar 2027 and delivered by 8 Mar 2027"] },
  requirementStatement: "Test requirement statement.",
  proposedRequirement: "Test instruction.",
  sectionEdits: scenario.case.sectionEdits,
  uncertainties: [],
};
const esClaims = [
  { statement: "Shipments need a delivery note in Spanish.", sourceId: "es-notice", quote: scenario.case.evidence[0].excerpt },
  { statement: "The pharmacy needs notice three business days ahead.", sourceId: "es-notice", quote: scenario.case.evidence[1].excerpt },
];
function esStandIn(draft) {
  return {
    models: {
      async generateContent(params) {
        assert.equal(params.config.systemInstruction.includes("Never translate a quote"), true);
        assert.ok(params.config.responseJsonSchema.required.includes("sectionEdits"));
        assert.deepEqual(params.config.responseJsonSchema.properties.claims.items.properties.sourceId.enum, ["es-spec-current", "es-notice"]);
        return { modelVersion: "test stand-in (no API call)", candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify(draft) }] } }] };
      },
    },
  };
}
const esGood = await draftChange(esSources, { client: esStandIn({ ...esBase, claims: esClaims }), profile: "es" });
const esGoodCheck = verifyDraft(esGood.draft, esSources, esRule);
assert.equal(esGoodCheck.verified, true, JSON.stringify(esGoodCheck.checks));
console.log("ok  Spain: a draft with real Spanish quotes, the right date and real section lines passes");
const translated = { statement: "A translated quote.", sourceId: "es-notice", quote: "every shipment to a clinical trial site in Spain needs a delivery note in Spanish" };
const esBad = verifyDraft({ ...esBase, claims: [...esClaims, translated] }, esSources, esRule);
assert.equal(esBad.checks.find(check => check.id === "quotes").ok, false);
console.log("ok  Spain: a translated or made-up quote is caught");
assert.equal(verifyDraft({ ...esBase, effectiveDate: "2027-03-08", claims: esClaims }, esSources, esRule).checks.find(check => check.id === "date").ok, false);
console.log("ok  Spain: a wrong effective date is caught");
const wrongLine = { section: "invoice", replaces: "A line that is not in the specification.", text: "New line." };
const esWrongEdit = verifyDraft({ ...esBase, sectionEdits: [wrongLine], claims: esClaims }, esSources, esRule);
assert.equal(esWrongEdit.checks.find(check => check.id === "edits").ok, false);
console.log("ok  Spain: an edit that replaces a line the specification does not have is caught");

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
if (process.argv.includes("--save-es")) {
  const dir = cacheDir(root);
  await mkdir(dir, { recursive: true });
  const result = {
    at: new Date().toISOString(),
    case: "es",
    model: esGood.model,
    rule: { requirement: esRule.requirement, effective: esRule.effective },
    sources: esSources.map(({ text, ...meta }) => ({ ...meta, characters: text.length })),
    diff: null,
    draft: esGood.draft,
    verification: esGoodCheck,
    usage: null,
  };
  await writeFile(join(dir, "analysis-es-latest.json"), JSON.stringify(result, null, 2));
  console.log(`saved a passing Spain test result to ${join(dir, "analysis-es-latest.json")}`);
}
console.log("All AI step checks passed.");
