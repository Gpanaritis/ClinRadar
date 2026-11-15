// The /v1 API: RegChain's application contract (Master Specification, section 9).
// The page uses it, and so can any other caller. Writes check the session's role on the server, require JSON from
// the same site, and accept an Idempotency-Key so a retried request never applies twice.

import { appendAudit, auditFor, eventEnvelope, newId, openDatabase, rememberedResponse, rememberResponse, schemaVersion, transaction, verifyAudit } from "./db.mjs";
import { applyAnalysis, applyCommand, caseRow, caseView, createCaseModel, ensureCases, resetCase, returnDueDeferrals, ROLES } from "./cases.mjs";
import { FIXTURE_SETS, recordedAnalysis, runReplay } from "./pipeline.mjs";
import { checkShipment, loadData, readApprovals, shipmentView } from "./rules.mjs";
import { OPENAPI } from "./openapi.mjs";
import { sessionFor, signIn, signOut } from "./auth.mjs";
import { createRateLimiter, clientAddress, securityHeaders } from "./security.mjs";
import { loadConfig } from "./config.mjs";
import { z } from "zod";

// Request bodies, checked before anything else runs.
const SCHEMAS = {
  session: z.object({ role: z.enum(["viewer", "reviewer", "owner", "verifier"]) }),
  login: z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(200) }),
  command: z.object({ action: z.enum(["approve", "edit", "reject", "investigate", "defer", "resume", "ack", "implement", "return", "verify"]), revision: z.number().int().positive(),
    reason: z.string().max(4000).nullish(), instruction: z.string().max(8000).nullish(), reviewOn: z.string().max(10).nullish(), override: z.boolean().optional(), today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  decision: z.object({ revision: z.number().int().positive(), outcome: z.enum(["approve", "reject"]), rationale: z.string().max(4000), override: z.boolean().optional(), today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  shipmentAction: z.object({ action: z.enum(["hold", "swap", "proceed"]), reason: z.string().max(4000) }),
  changeDecision: z.object({ decision: z.enum(["not-relevant", "case", "assessing"]), reason: z.string().max(4000) }),
  replay: z.object({ fixture_set: z.enum(["uk-labelling", "es-notice"]).optional(), extraction_mode: z.enum(["live", "recorded"]).optional(), analysis_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  empty: z.object({}).passthrough(),
};
function validate(schema, body) {
  const result = SCHEMAS[schema].safeParse(body);
  if (!result.success) throw Object.assign(new Error("Invalid request: " + result.error.issues.map(issue => (issue.path.join(".") || "body") + " " + issue.message).join("; ")), { statusCode: 422 });
  return result.data;
}

const SESSION_COOKIE = "rc_session";
const json = (response, status, body, headers = {}) => {
  response.writeHead(status, { ...securityHeaders(), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(body));
};
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

async function readBody(request) {
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) throw fail(415, "Send JSON.");
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 20000) throw fail(413, "Request too large.");
  }
  try { return JSON.parse(body || "{}"); } catch { throw fail(400, "Invalid JSON."); }
}
function cookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map(part => part.trim().split("=")).filter(([key]) => key).map(([key, ...value]) => [key, decodeURIComponent(value.join("="))]));
}

// Routes anyone may call in a shared deployment; everything else needs a signed-in user.
const PUBLIC_ROUTES = [["GET", /^\/v1\/health$/], ["GET", /^\/v1\/session$/], ["POST", /^\/v1\/auth\/login$/], ["GET", /^\/v1\/openapi\.json$/]];

export function createApi({ root, config = loadConfig(), allowedOrigins = config.origins, analyze, now = () => new Date().toISOString(), logger = null }) {
  let ready = null;
  const writeLimit = createRateLimiter(config.writesPerMinute);
  const cookie = (id, maxAge) => `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict${config.secureCookies ? "; Secure" : ""}${maxAge !== undefined ? "; Max-Age=" + maxAge : ""}`;
  // Open the database, build the case model from the data files, create the cases and replay the recorded sources once.
  async function context() {
    ready ??= (async () => {
      const db = openDatabase(root);
      const data = await loadData(root);
      const model = createCaseModel(data);
      const analyses = Object.fromEntries(await Promise.all(Object.entries(FIXTURE_SETS).map(async ([set, fixture]) => [fixture.caseKey, await recordedAnalysis(root, set)])));
      ensureCases(db, model, { analyses });
      if (!db.prepare("SELECT 1 FROM replay_run LIMIT 1").get()) {
        for (const set of Object.keys(FIXTURE_SETS)) {
          try { await runReplay(db, model, root, { fixtureSet: set, extractionMode: "recorded" }); } catch (error) { console.error(`Initial ${set} replay failed: ${error.message}`); }
        }
      }
      dispatchOutbox(db);
      return { db, model, today: data.today };
    })().catch(error => { ready = null; throw error; });
    return ready;
  }

  function session(db, request) {
    return sessionFor(db, config, cookies(request)[SESSION_COOKIE]);
  }
  // Who is acting: the signed-in person, or in local mode the case's named person for the chosen role.
  const actorOf = (model, current) => (current?.user ? { name: current.user.name, role: current.role } : null);
  const actorLabel = (model, current) => (current?.user ? current.user.name + " · " + ROLES[current.role] : model.roleName(current?.role, { caseId: "uk" }));
  function requireSameSite(request) {
    const origin = request.headers.origin;
    const site = request.headers["sec-fetch-site"];
    if ((origin && !allowedOrigins.includes(origin)) || (site && !["same-origin", "none"].includes(site))) throw fail(403, "Requests from other sites are refused.");
  }
  // Shipments a case's Quality task covers that are still blocked and have no recorded action or approved agent plan.
  async function unresolvedFor(db) {
    const data = await loadData(root);
    const approvals = await readApprovals(root);
    const manual = new Set(db.prepare("SELECT shipment_id FROM shipment_action").all().map(row => row.shipment_id));
    return state => {
      const task = state.task;
      if (!task) return [];
      return [...(task.shipmentIds ?? []), ...(task.checkShipmentIds ?? [])].filter(id => shipmentView(data, id) && checkShipment(data, id).result === "Blocked" && !manual.has(id) && !approvals[id]);
    };
  }
  async function latestAnalysis(caseKey) {
    const set = Object.keys(FIXTURE_SETS).find(key => FIXTURE_SETS[key].caseKey === caseKey);
    return set ? recordedAnalysis(root, set) : null;
  }

  // Deliver pending outbox events. The mock QMS records one receipt per event and deduplicates by event ID.
  function dispatchOutbox(db) {
    for (const row of db.prepare("SELECT * FROM outbox_event WHERE status IN ('pending', 'retry') ORDER BY seq").all()) {
      try {
        transaction(db, () => {
          const data = JSON.parse(row.data);
          if (row.type === "downstream_action.required") {
            db.prepare("INSERT OR IGNORE INTO qms_receipt (event_id, action_id, received_at) VALUES (?, ?, ?)").run(row.id, data.action_id, now());
            db.prepare("UPDATE action SET receipt = ?, updated_at = ? WHERE id = ?").run("QMS-RCPT-" + row.id.slice(-8).toUpperCase(), now(), data.action_id);
          }
          db.prepare("UPDATE outbox_event SET status = 'dispatched', attempts = attempts + 1, dispatched_at = ? WHERE id = ?").run(now(), row.id);
        });
      } catch (error) {
        db.prepare("UPDATE outbox_event SET status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'retry' END, attempts = attempts + 1, last_error = ? WHERE id = ?").run(String(error.message), row.id);
      }
    }
  }

  // Run a write with an optional Idempotency-Key: an exact retry returns the first response.
  async function idempotent(db, request, scope, body, work) {
    const key = request.headers["idempotency-key"] ? String(request.headers["idempotency-key"]).slice(0, 200) : null;
    const remembered = rememberedResponse(db, key, scope, body);
    if (remembered) return remembered;
    const result = await work();
    rememberResponse(db, key, scope, body, result.status, result.body);
    dispatchOutbox(db);
    return result;
  }

  const routes = [
    ["GET", /^\/v1\/health$/, async ({ db, request }) => {
      // A broken audit chain is an incident: the check fails (503) so monitoring raises it. Details only for signed-in users.
      const audit = verifyAudit(db);
      const detail = config.auth === "local" || Boolean(session(db, request)?.user);
      return { status: audit.ok ? 200 : 503, body: { status: audit.ok ? "ok" : "audit_chain_broken", schema_version: schemaVersion(db), ...(detail ? { audit } : { audit: { ok: audit.ok } }), time: now() } };
    }],
    ["GET", /^\/v1\/openapi\.json$/, async () => ({ status: 200, body: OPENAPI })],
    ["GET", /^\/v1\/session$/, async ({ db, request }) => {
      const row = session(db, request);
      return { status: 200, body: { mode: config.auth, role: row?.role ?? null, user: row?.user ?? null, roles: ROLES } };
    }],
    ["POST", /^\/v1\/auth\/login$/, async ({ db, request }) => {
      requireSameSite(request);
      if (config.auth !== "password") throw fail(404, "Sign-in is not used on this computer: choose a role instead.");
      const body = validate("login", await readBody(request));
      const result = signIn(db, config, { username: body.username, password: body.password, address: clientAddress(request, config.trustProxy) });
      return { status: 200, body: { mode: config.auth, role: result.user.role, user: result.user, roles: ROLES, expires_at: result.expiresAt },
        headers: { "Set-Cookie": cookie(result.sessionId, config.sessionMaxHours * 3600) } };
    }],
    ["POST", /^\/v1\/auth\/logout$/, async ({ db, request }) => {
      requireSameSite(request);
      signOut(db, session(db, request));
      return { status: 200, body: { signed_out: true }, headers: { "Set-Cookie": cookie("", 0) } };
    }],
    ["POST", /^\/v1\/session$/, async ({ db, request, model }) => {
      requireSameSite(request);
      if (config.auth === "password") throw fail(403, "Your role comes from your account. Sign in as the person who holds the other role.");
      const body = validate("session", await readBody(request));
      let id = cookies(request)[SESSION_COOKIE];
      const existing = id ? db.prepare("SELECT id FROM session WHERE id = ?").get(id) : null;
      if (existing) db.prepare("UPDATE session SET role = ?, last_seen = ? WHERE id = ?").run(body.role, now(), id);
      else {
        id = newId("ses");
        db.prepare("INSERT INTO session (id, role, created_at, last_seen) VALUES (?, ?, ?, ?)").run(id, body.role, now(), now());
      }
      appendAudit(db, { actor: model.roleName(body.role, { caseId: "uk" }) ?? body.role, role: body.role, type: "session.role_selected", subjectType: "session", subjectId: id, detail: "Acting as " + ROLES[body.role] });
      return { status: 200, body: { mode: config.auth, role: body.role, user: null, roles: ROLES }, headers: { "Set-Cookie": cookie(id) } };
    }],
    ["GET", /^\/v1\/cases$/, async ({ db, model }) => ({ status: 200, body: { cases: Object.keys(model.governedCases).map(key => caseView(db, model, key)) } })],
    ["GET", /^\/v1\/cases\/([^/]+)$/, async ({ db, model, match }) => {
      const view = caseView(db, model, match[1]);
      if (!view) throw fail(404, "Unknown case.");
      return { status: 200, body: view };
    }],
    ["POST", /^\/v1\/cases\/([^/]+)\/commands$/, async ({ db, model, request, match }) => {
      requireSameSite(request);
      const body = validate("command", await readBody(request));
      const current = session(db, request);
      const role = current?.role;
      const row = caseRow(db, match[1]);
      if (!row) throw fail(404, "Unknown case.");
      return idempotent(db, request, "case-command:" + row.id, body, async () => {
        const unresolved = await unresolvedFor(db);
        const state = applyCommand(db, model, row.case_key, { action: body.action, revision: body.revision, reason: body.reason, instruction: body.instruction, reviewOn: body.reviewOn, override: Boolean(body.override), today: body.today },
          { role, actor: actorOf(model, current), now: now(), analysis: await latestAnalysis(row.case_key), unresolved });
        return { status: 200, body: { workflow: state } };
      });
    }],
    // The specification's decision route: approve or reject an exact proposal revision.
    ["POST", /^\/v1\/proposals\/([^/]+)\/decisions$/, async ({ db, model, request, match }) => {
      requireSameSite(request);
      if (!request.headers["idempotency-key"]) throw fail(400, "Send an Idempotency-Key header.");
      const body = validate("decision", await readBody(request));
      const row = caseRow(db, match[1]);
      if (!row) throw fail(404, "Unknown case.");
      const current = session(db, request);
      return idempotent(db, request, "decision:" + row.id, body, async () => {
        const state = applyCommand(db, model, row.case_key, { action: body.outcome, revision: body.revision, reason: body.rationale, override: Boolean(body.override), today: body.today },
          { role: current?.role, actor: actorOf(model, current), now: now(), analysis: await latestAnalysis(row.case_key), unresolved: await unresolvedFor(db) });
        const decision = db.prepare("SELECT id FROM decision WHERE case_id = ? ORDER BY decided_at DESC LIMIT 1").get(row.id);
        const publication = db.prepare("SELECT id, number, receipt FROM requirement_version WHERE decision_id = ?").get(decision?.id ?? "");
        return { status: 200, body: { decision_id: decision?.id ?? null, publication: publication ?? null, workflow: state } };
      });
    }],
    ["POST", /^\/v1\/actions\/([^/]+)\/acknowledgements$/, async ({ db, model, request, match }) => {
      requireSameSite(request);
      const body = await readBody(request);
      const action = db.prepare("SELECT * FROM action WHERE id = ?").get(match[1]);
      if (!action) throw fail(404, "Unknown action.");
      const row = db.prepare("SELECT case_key, state FROM change_case WHERE id = ?").get(action.case_id);
      const current = session(db, request);
      return idempotent(db, request, "ack:" + action.id, body, async () => {
        const state = applyCommand(db, model, row.case_key, { action: "ack", revision: JSON.parse(row.state).revision }, { role: current?.role, actor: actorOf(model, current), now: now() });
        return { status: 200, body: { action_id: action.id, status: state.task.status, case_stage: state.stage } };
      });
    }],
    ["POST", /^\/v1\/cases\/([^/]+)\/reset$/, async ({ db, model, request, match }) => {
      requireSameSite(request);
      await readBody(request);
      const row = caseRow(db, match[1]);
      if (!row) throw fail(404, "Unknown case.");
      const current = session(db, request);
      if (config.auth === "password" && !["reviewer", "verifier"].includes(current?.role)) throw fail(403, "Only Regulatory or Quality can start a case again.");
      const state = resetCase(db, model, row.case_key, { role: current?.role ?? null, actor: actorOf(model, current), now: now(), analysis: await latestAnalysis(row.case_key) });
      return { status: 200, body: { workflow: state } };
    }],
    ["GET", /^\/v1\/cases\/([^/]+)\/impact$/, async ({ db, match }) => {
      const row = caseRow(db, match[1]);
      if (!row) throw fail(404, "Unknown case.");
      const assessment = db.prepare("SELECT * FROM impact_assessment WHERE case_id = ? ORDER BY prepared_at DESC LIMIT 1").get(row.id);
      if (!assessment) throw fail(404, "No assessment yet. Run a replay.");
      const findings = db.prepare("SELECT object_type, object_id, result, impact, rationale, inputs, evidence_keys FROM impact_finding WHERE assessment_id = ? ORDER BY object_type, object_id").all(assessment.id)
        .map(item => ({ ...item, inputs: JSON.parse(item.inputs), evidence_keys: JSON.parse(item.evidence_keys) }));
      return { status: 200, body: { case_id: row.id, assessment_id: assessment.id, rule_version: assessment.rule_version, portfolio_snapshot_id: assessment.portfolio_snapshot_id,
        prepared_at: assessment.prepared_at, summary: JSON.parse(assessment.summary), proposal_revision: row.state.revision, findings } };
    }],
    ["GET", /^\/v1\/cases\/([^/]+)\/events$/, async ({ db, match }) => {
      const row = caseRow(db, match[1]);
      if (!row) throw fail(404, "Unknown case.");
      return { status: 200, body: { events: db.prepare("SELECT * FROM outbox_event WHERE aggregate_id = ? ORDER BY seq").all(row.id).map(eventEnvelope) } };
    }],
    ["GET", /^\/v1\/cases\/([^/]+)\/audit$/, async ({ db, match }) => {
      const row = caseRow(db, match[1]);
      if (!row) throw fail(404, "Unknown case.");
      return { status: 200, body: { entries: auditFor(db, "change_case", row.id), chain: verifyAudit(db) } };
    }],
    ["GET", /^\/v1\/audit\/verify$/, async ({ db }) => ({ status: 200, body: verifyAudit(db) })],
    ["GET", /^\/v1\/evidence\/([^/]+)$/, async ({ db, match }) => {
      const span = db.prepare(`SELECT e.*, v.source_id, v.edition, v.retrieved_at, v.raw_sha256, s.title, s.authority, s.url FROM evidence_span e
        JOIN source_version v ON v.id = e.source_version_id JOIN source s ON s.id = v.source_id WHERE e.evidence_key = ? OR e.id = ? ORDER BY v.retrieved_at DESC LIMIT 1`).get(match[1], match[1]);
      if (!span) throw fail(404, "Unknown evidence, or not found in the stored source text.");
      return { status: 200, body: { id: span.id, evidence_key: span.evidence_key, excerpt: span.text, locator: span.locator, offsets: [span.start_offset, span.end_offset], span_sha256: span.span_sha256,
        source: { id: span.source_id, title: span.title, authority: span.authority, url: span.url, version_id: span.source_version_id, edition: span.edition, retrieved_at: span.retrieved_at, raw_sha256: span.raw_sha256 } } };
    }],
    ["GET", /^\/v1\/requirements\/(.+)\/versions$/, async ({ db, match, url }) => {
      const key = decodeURIComponent(match[1]);
      const applicableOn = url.searchParams.get("applicable_on");
      const knownAt = url.searchParams.get("known_at") ?? now();
      const versions = db.prepare("SELECT * FROM requirement_version WHERE requirement_key = ? ORDER BY published_at, number").all(key)
        .map(item => ({ ...item, body: JSON.parse(item.body), evidence_ids: JSON.parse(item.evidence_ids) }));
      if (!versions.length) throw fail(404, "Unknown requirement.");
      const visible = versions.filter(item => item.status === "in_force" && item.published_at <= knownAt);
      const applicable = applicableOn ? [...visible].filter(item => (item.applicable_from ?? "0000") <= applicableOn).sort((a, b) => (b.applicable_from ?? "").localeCompare(a.applicable_from ?? ""))[0] ?? null : null;
      return { status: 200, body: { requirement_key: key, versions, ...(applicableOn ? { applicable_on: applicableOn, known_at: knownAt, applicable_version: applicable } : {}) } };
    }],
    ["GET", /^\/v1\/specifications\/([^/]+)\/versions$/, async ({ db, match }) => ({ status: 200, body: { country: match[1],
      versions: db.prepare("SELECT id, version, published_at, status, case_id, decision_id, sections FROM specification_version WHERE country = ? ORDER BY published_at").all(match[1]).map(item => ({ ...item, sections: JSON.parse(item.sections) })) } })],
    ["GET", /^\/v1\/replays$/, async ({ db }) => ({ status: 200, body: { runs: db.prepare("SELECT * FROM replay_run ORDER BY started_at DESC LIMIT 50").all().map(item => ({ ...item, case_ids: JSON.parse(item.case_ids ?? "[]") })) } })],
    ["POST", /^\/v1\/replays$/, async ({ db, model, request }) => {
      requireSameSite(request);
      const body = validate("replay", await readBody(request));
      return idempotent(db, request, "replay", body, async () => {
        const result = await runReplay(db, model, root, { fixtureSet: body.fixture_set ?? "uk-labelling", extractionMode: body.extraction_mode ?? "recorded", analysisDate: body.analysis_date, analyze,
          actor: actorLabel(model, session(db, request)) ?? "RegChain pipeline" });
        return { status: 200, body: { ...result, workflow: caseRow(db, FIXTURE_SETS[body.fixture_set ?? "uk-labelling"].caseKey)?.state ?? null } };
      });
    }],
    ["POST", /^\/v1\/outbox\/dispatch$/, async ({ db, request }) => {
      requireSameSite(request);
      db.prepare("UPDATE outbox_event SET status = 'retry' WHERE status = 'failed'").run();
      dispatchOutbox(db);
      return { status: 200, body: { pending: db.prepare("SELECT COUNT(*) AS n FROM outbox_event WHERE status != 'dispatched'").get().n } };
    }],
    // An owner decision on a change without a governed case. Only the Regulatory SME records one.
    ["GET", /^\/v1\/change-decisions$/, async ({ db }) => ({ status: 200, body: { decisions: Object.fromEntries(db.prepare("SELECT * FROM change_decision").all().map(row => [row.change_id, { decision: row.decision, reason: row.reason, by: row.actor, at: row.decided_at }])) } })],
    ["PUT", /^\/v1\/change-decisions\/([^/]+)$/, async ({ db, model, request, match }) => {
      requireSameSite(request);
      const body = validate("changeDecision", await readBody(request));
      const current = session(db, request);
      const role = current?.role;
      if (role !== "reviewer") throw fail(403, "Switch to Regulatory SME to record a decision on this change.");
      const reason = String(body.reason ?? "").trim();
      if (!reason) throw fail(422, "Give a reason for the decision.");
      const actor = actorLabel(model, current);
      const at = now();
      transaction(db, () => {
        db.prepare("INSERT INTO change_decision (change_id, decision, reason, actor, decided_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(change_id) DO UPDATE SET decision = excluded.decision, reason = excluded.reason, actor = excluded.actor, decided_at = excluded.decided_at")
          .run(match[1], body.decision, reason, actor, at);
        appendAudit(db, { actor, role, type: "change_decision.recorded", subjectType: "change", subjectId: match[1], detail: body.decision + ": " + reason, at });
      });
      return { status: 200, body: { change_id: match[1], decision: body.decision, reason, by: actor, at } };
    }],
    ["GET", /^\/v1\/shipment-actions$/, async ({ db }) => ({ status: 200, body: { actions: Object.fromEntries(db.prepare("SELECT * FROM shipment_action").all().map(row => [row.shipment_id, { action: row.action, reason: row.reason, by: row.actor, at: row.recorded_at }])) } })],
    ["PUT", /^\/v1\/shipment-actions\/([^/]+)$/, async ({ db, model, request, match }) => {
      requireSameSite(request);
      const body = validate("shipmentAction", await readBody(request));
      const current = session(db, request);
      const role = current?.role;
      if (!ROLES[role]) throw fail(401, "Choose a role first.");
      if (config.auth === "password" && role !== "viewer") throw fail(403, "Clinical Supply records shipment actions.");
      const reason = String(body.reason ?? "").trim();
      if (!reason) throw fail(422, "Give a reason for the action.");
      const data = await loadData(root);
      if (!shipmentView(data, match[1])) throw fail(404, "Unknown shipment.");
      const actor = actorLabel(model, current);
      const at = now();
      transaction(db, () => {
        db.prepare("INSERT INTO shipment_action (shipment_id, action, reason, actor, recorded_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(shipment_id) DO UPDATE SET action = excluded.action, reason = excluded.reason, actor = excluded.actor, recorded_at = excluded.recorded_at")
          .run(match[1], body.action, reason, actor, at);
        appendAudit(db, { actor, role, type: "shipment_action.recorded", subjectType: "shipment", subjectId: match[1], detail: body.action + ": " + reason, data: { result: checkShipment(data, match[1]).result }, at });
      });
      return { status: 200, body: { shipment_id: match[1], action: body.action, reason, by: actor, at } };
    }],
    ["DELETE", /^\/v1\/shipment-actions\/([^/]+)$/, async ({ db, model, request, match }) => {
      requireSameSite(request);
      const current = session(db, request);
      const role = current?.role;
      if (!ROLES[role]) throw fail(401, "Choose a role first.");
      if (config.auth === "password" && role !== "viewer") throw fail(403, "Clinical Supply clears shipment actions.");
      const actor = actorLabel(model, current);
      transaction(db, () => {
        db.prepare("DELETE FROM shipment_action WHERE shipment_id = ?").run(match[1]);
        appendAudit(db, { actor, role, type: "shipment_action.cleared", subjectType: "shipment", subjectId: match[1], detail: "Action cleared" });
      });
      return { status: 200, body: { shipment_id: match[1], cleared: true } };
    }],
  ];

  // Record an AI check that the existing /api/ai/analyze route produced, so the case adopts it on the server.
  async function recordAnalysisResult(caseKey, result) {
    const { db, model } = await context();
    return applyAnalysis(db, model, caseKey, result, { now: now() });
  }

  const HSTS = config.secureCookies ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {};
  async function handle(request, response, url) {
    const route = routes.find(([method, pattern]) => method === request.method && pattern.test(url.pathname));
    if (!route) {
      const known = routes.some(([, pattern]) => pattern.test(url.pathname));
      return json(response, known ? 405 : 404, { error: known ? "Method not allowed." : "Not found." }, HSTS);
    }
    try {
      if (request.method !== "GET") {
        const wait = writeLimit(clientAddress(request, config.trustProxy));
        if (wait) return json(response, 429, { error: "Too many requests. Try again in a minute." }, { ...HSTS, "Retry-After": String(wait) });
      }
      const { db, model, today } = await context();
      if (config.auth === "password" && !PUBLIC_ROUTES.some(([method, pattern]) => method === request.method && pattern.test(url.pathname)) && !session(db, request)?.user) {
        return json(response, 401, { error: "Sign in first." }, HSTS);
      }
      if (request.method === "GET" && url.pathname.startsWith("/v1/cases")) returnDueDeferrals(db, model, today, now());
      const result = await route[2]({ db, model, request, response, url, match: url.pathname.match(route[1]) });
      json(response, result.status, result.body, { ...HSTS, ...result.headers });
    } catch (error) {
      const status = error.statusCode ?? 500;
      if (status >= 500) (logger?.error ?? console.error)(`${request.method} ${url.pathname} failed`, { request_id: response.getHeader("X-Request-Id"), error: error.stack ?? error.message });
      json(response, status, { error: status >= 500 ? "The server could not complete the request." : error.message }, HSTS);
    }
  }
  async function authenticate(request) {
    const { db } = await context();
    return session(db, request);
  }
  async function actorFor(request) {
    const { db, model } = await context();
    const current = session(db, request);
    return { session: current, label: current ? actorLabel(model, current) : null };
  }
  return { handle, context, recordAnalysisResult, authenticate, actorFor, config };
}
