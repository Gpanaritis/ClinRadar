// The regulation pipeline: snapshot the official sources, keep each version with its hashes, locate every evidence
// passage, compare the versions, record the AI extraction (live or recorded), assess the portfolio with fixed rules
// and emit the lifecycle events. Identical inputs reuse the case they already produced.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { addOutboxEvent, appendAudit, canonical, newId, sha256, transaction } from "./db.mjs";
import { applyAnalysis, caseRow } from "./cases.mjs";
import { RULE_VERSIONS } from "./impact.mjs";
import { cacheDir, diffLines, fingerprint, loadSources, normalise } from "./sources.mjs";
import { loadSpainSources } from "./spain.mjs";

export const FIXTURE_SETS = {
  "uk-labelling": { caseKey: "uk", jurisdiction: "GB", analysisFile: "analysis-latest.json" },
  "es-notice": { caseKey: "es", jurisdiction: "ES", analysisFile: "analysis-es-latest.json" },
};
// The page's evidence sources, mapped to the documents the pipeline stores.
const EVIDENCE_SOURCES = { statute: "sch14-para6", transition: "mhra-labelling-transition" };
const TIERS = { legislation: 1, govuk: 2, notice: 2, company: 3 };

export async function recordedAnalysis(root, fixtureSet) {
  try { return JSON.parse(await readFile(join(cacheDir(root), FIXTURE_SETS[fixtureSet].analysisFile), "utf8")); } catch { return null; }
}

function storeSource(db, source, jurisdiction) {
  db.prepare(`INSERT INTO source (id, title, authority, jurisdiction, tier, kind, url) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, authority = excluded.authority, url = excluded.url`)
    .run(source.id, source.title, source.authority, jurisdiction, TIERS[source.kind] ?? 3, source.kind, source.url ?? null);
  if (!source.text) return null;
  const raw = sha256(source.text);
  const existing = db.prepare("SELECT id FROM source_version WHERE source_id = ? AND raw_sha256 = ?").get(source.id, raw);
  if (existing) return { id: existing.id, fresh: false, normalized: fingerprint(source.text) };
  const id = newId("srcv");
  db.prepare("INSERT INTO source_version (id, source_id, edition, retrieved_at, raw_sha256, normalized_sha256, text, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, source.id, source.validFrom ?? null, source.retrievedAt ?? new Date().toISOString(), raw, fingerprint(source.text), source.text, source.origin ?? "live");
  return { id, fresh: true, normalized: fingerprint(source.text) };
}

// Find an excerpt in the stored text (after the same normalisation used for quotes) and keep its offsets and hash.
function storeEvidence(db, versionId, text, item) {
  const haystack = normalise(text);
  const needle = normalise(item.excerpt);
  const start = needle ? haystack.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (start < 0) return { key: item.id, found: false };
  const span = haystack.slice(start, start + needle.length);
  db.prepare(`INSERT OR IGNORE INTO evidence_span (id, source_version_id, evidence_key, locator, text, start_offset, end_offset, span_sha256)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(newId("ev"), versionId, item.id, item.locator, span, start, start + needle.length, sha256(span));
  return { key: item.id, found: true };
}

export async function runReplay(db, model, root, { fixtureSet = "uk-labelling", extractionMode = "recorded", analysisDate, analyze, actor = "RegChain pipeline" } = {}) {
  const fixture = FIXTURE_SETS[fixtureSet];
  if (!fixture) throw Object.assign(new Error("Unknown fixture set."), { statusCode: 422 });
  if (!["live", "recorded"].includes(extractionMode)) throw Object.assign(new Error("extraction_mode must be live or recorded."), { statusCode: 422 });
  const runId = newId("run");
  const startedAt = new Date().toISOString();
  const day = analysisDate ?? startedAt.slice(0, 10);
  db.prepare("INSERT INTO replay_run (id, fixture_set, extraction_mode, analysis_date, started_at, status) VALUES (?, ?, ?, ?, ?, 'running')").run(runId, fixtureSet, extractionMode, day, startedAt);
  try {
    // 1. Sources: live fetch when asked, otherwise the last stored copy.
    const sources = fixtureSet === "uk-labelling" ? await loadSources(root, { refresh: extractionMode === "live" }) : await loadSpainSources(root);
    const before = sources.find(source => source.role === "before");
    const after = sources.find(source => source.role === "after");
    // 2. Extraction: a live AI call, or the last recorded result.
    const analysis = extractionMode === "live" ? await analyze(fixture.caseKey) : await recordedAnalysis(root, fixtureSet);
    const governed = model.governedCases[fixture.caseKey];
    const outcome = transaction(db, () => {
      const versions = Object.fromEntries(sources.map(source => [source.id, storeSource(db, source, fixture.jurisdiction)]));
      const missing = sources.filter(source => !source.text).map(source => source.id);
      // 3. Evidence passages, resolved against the stored text.
      const evidence = governed.evidence.map(item => {
        const sourceId = EVIDENCE_SOURCES[item.source] ?? item.source;
        const source = sources.find(entry => entry.id === sourceId);
        return source?.text && versions[sourceId] ? storeEvidence(db, versions[sourceId].id, source.text, item) : { key: item.id, found: false };
      });
      // 4. Comparison: a meaningful change, a new document, or nothing material.
      let comparison;
      if (!after?.text) comparison = "source_unavailable";
      else if (fixtureSet === "es-notice") comparison = "new_document";
      else comparison = before?.text && fingerprint(before.text) === fingerprint(after.text) ? "no_relevant_change" : "material_change";
      const diff = fixtureSet === "uk-labelling" && before?.text && after?.text ? diffLines(before.text, after.text) : null;
      const row = caseRow(db, fixture.caseKey);
      const fingerprintValue = sha256(canonical({ case: fixture.caseKey, before: before?.text ? fingerprint(before.text) : null, after: after?.text ? fingerprint(after.text) : null }));
      const caseIds = [];
      if (["material_change", "new_document"].includes(comparison) && row) {
        caseIds.push(row.id);
        if (row.fingerprint !== fingerprintValue) {
          db.prepare("UPDATE change_case SET fingerprint = ?, old_version_id = ?, new_version_id = ? WHERE id = ?")
            .run(fingerprintValue, before?.text ? versions[before.id]?.id : null, versions[after.id]?.id ?? null, row.id);
          appendAudit(db, { actor, type: row.fingerprint ? "regulatory_change.redetected" : "regulatory_change.detected", subjectType: "change_case", subjectId: row.id,
            detail: comparison === "new_document" ? "New document: " + after.title : "Source versions differ: " + (diff ? diff.added + " lines added, " + diff.removed + " removed" : "content changed"),
            data: { run_id: runId, fingerprint: fingerprintValue, before: before?.id ?? null, after: after.id }, correlationId: row.id });
          addOutboxEvent(db, { type: "regulatory_change.detected", aggregateType: "change_case", aggregateId: row.id, aggregateVersion: row.state_version, correlationId: row.id,
            evidenceIds: evidence.filter(item => item.found).map(item => item.key), data: { run_id: runId, comparison, source_versions: Object.values(versions).filter(Boolean).map(item => item.id) } });
        }
      }
      // 5. Impact assessment with fixed rules, against a stored portfolio snapshot.
      let assessmentId = null;
      if (caseIds.length) {
        const snapshotData = canonical({ portfolio: model.portfolioSeed, spain: model.spainSeed });
        const snapshotSha = sha256(snapshotData);
        let snapshot = db.prepare("SELECT id FROM portfolio_snapshot WHERE sha256 = ?").get(snapshotSha);
        if (!snapshot) {
          snapshot = { id: newId("pf") };
          db.prepare("INSERT INTO portfolio_snapshot (id, sha256, imported_at, data) VALUES (?, ?, ?, ?)").run(snapshot.id, snapshotSha, new Date().toISOString(), snapshotData);
        }
        assessmentId = newId("asm");
        const findings = model.impact.findings(fixture.caseKey);
        const summary = { objects: findings.length, act: findings.filter(item => item.impact === "Act").length, check: findings.filter(item => item.impact === "Check").length };
        db.prepare("INSERT INTO impact_assessment (id, case_id, rule_version, portfolio_snapshot_id, prepared_at, summary) VALUES (?, ?, ?, ?, ?, ?)")
          .run(assessmentId, row.id, RULE_VERSIONS[fixture.caseKey], snapshot.id, new Date().toISOString(), JSON.stringify(summary));
        const insert = db.prepare("INSERT INTO impact_finding (id, assessment_id, object_type, object_id, result, impact, rationale, inputs, evidence_keys) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        for (const finding of findings) insert.run(newId("fnd"), assessmentId, finding.objectType, finding.objectId, finding.result, finding.impact, finding.rationale, JSON.stringify(finding.inputs), JSON.stringify(finding.evidenceKeys));
        appendAudit(db, { actor, type: "impact_assessment.prepared", subjectType: "change_case", subjectId: row.id, detail: `${summary.act} to act on, ${summary.check} to check, ${summary.objects} objects assessed with ${RULE_VERSIONS[fixture.caseKey]}`,
          data: { run_id: runId, assessment_id: assessmentId, portfolio_snapshot_id: snapshot.id }, correlationId: row.id });
        addOutboxEvent(db, { type: "impact_assessment.prepared", aggregateType: "change_case", aggregateId: row.id, aggregateVersion: row.state_version, correlationId: row.id,
          data: { run_id: runId, assessment_id: assessmentId, rule_version: RULE_VERSIONS[fixture.caseKey], ...summary } });
      }
      return { versions, missing, evidence, comparison, diff: diff ? { added: diff.added, removed: diff.removed } : null, caseIds, assessmentId, rowId: row?.id };
    });
    // 6. The extraction, recorded on the case: logged once per run, adopted as the proposal when every check passes.
    let extraction = { mode: extractionMode, status: "missing" };
    if (analysis && outcome.caseIds.length) {
      const state = applyAnalysis(db, model, fixture.caseKey, analysis);
      extraction = { mode: extractionMode, status: analysis.verification?.verified ? "verified" : "failed", at: analysis.at, model: analysis.model, adopted: state?.aiRunAt === analysis.at };
      if (state?.stage === "review") {
        transaction(db, () => addOutboxEvent(db, { type: "expert_review.requested", aggregateType: "change_case", aggregateId: outcome.rowId, aggregateVersion: caseRow(db, fixture.caseKey).state_version,
          correlationId: outcome.rowId, data: { revision: state.revision, reviewer_role: "regulatory_sme", extraction: extraction.status } }));
      }
    }
    const result = { run_id: runId, fixture_set: fixtureSet, case_ids: outcome.caseIds, comparison_status: outcome.comparison, diff: outcome.diff,
      source_versions: Object.fromEntries(Object.entries(outcome.versions).filter(([, value]) => value).map(([key, value]) => [key, { id: value.id, new: value.fresh }])),
      sources_missing: outcome.missing, evidence: outcome.evidence, assessment_id: outcome.assessmentId, extraction };
    db.prepare("UPDATE replay_run SET finished_at = ?, status = 'completed', comparison = ?, case_ids = ? WHERE id = ?").run(new Date().toISOString(), outcome.comparison, JSON.stringify(outcome.caseIds), runId);
    return result;
  } catch (error) {
    db.prepare("UPDATE replay_run SET finished_at = ?, status = 'failed', error = ? WHERE id = ?").run(new Date().toISOString(), String(error.message ?? error), runId);
    throw error;
  }
}
