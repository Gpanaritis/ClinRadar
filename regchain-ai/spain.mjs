// The fictional Spain case: a new information note (in Spanish) and the current
// Spain Country Specification, both from demo-data/spain-scenario.json.
// Nothing here is fetched: the note and the specification are invented for the demo.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fingerprint } from "./sources.mjs";

export async function loadSpainScenario(root) {
  return JSON.parse(await readFile(join(root, "demo-data", "spain-scenario.json"), "utf8"));
}

const sectionNames = {
  regulatory: "Regulatory requirements", import: "Import and export rules", invoice: "Mandatory invoice statements",
  logistics: "Logistics constraints", carriers: "Approved carriers", ior: "Importer of record and consignee",
  contacts: "Local contacts", notes: "Country-specific notes",
};

// The specification as plain text, one section per block, so the AI can quote the line an edit replaces.
function specificationText(spec) {
  return Object.entries(spec.sections).map(([id, section]) =>
    `${sectionNames[id] ?? id} [${id}]\n${section.items.map(item => `- ${item}`).join("\n")}`).join("\n\n");
}

export async function loadSpainSources(root) {
  const scenario = await loadSpainScenario(root);
  const spec = scenario.specification;
  const notice = scenario.notice;
  const make = (meta, text) => ({ ...meta, text, hash: fingerprint(text), origin: "demo file", retrievedAt: new Date().toISOString() });
  return [
    make({ id: "es-spec-current", role: "before", kind: "company", title: `Spain Country Specification v${spec.version} (fictional)`, authority: "Company record (fictional)",
      url: null, validFrom: spec.published, validUntil: null }, `Spain Country Specification v${spec.version} (fictional)\n\n${specificationText(spec)}`),
    make({ id: notice.id, role: "after", kind: "notice", title: notice.title, authority: notice.authority,
      url: null, validFrom: notice.published, validUntil: null, language: notice.language }, notice.text),
  ];
}

// The recorded company rule the AI draft is checked against (mirrors esCase in the dashboard).
export async function spainRule(root) {
  const scenario = await loadSpainScenario(root);
  return {
    requirement: scenario.case.requirement,
    effective: scenario.case.effective,
    sourcesLabel: "The new note and the current specification were read",
    sourcesDetail: `Information note ${scenario.notice.published} and specification v${scenario.specification.version}`,
    sections: Object.fromEntries(Object.entries(scenario.specification.sections).map(([id, section]) => [id, section.items])),
  };
}
