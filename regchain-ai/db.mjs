// RegChain's system of record: one SQLite database (Node's built-in node:sqlite).
// It holds what RegChain owns: source versions and evidence, change cases and their workflow, proposals and
// decisions, published requirement and specification versions, impact findings, shipment actions, sessions,
// the append-only audit trail and the event outbox. Validated systems (IRT, ERP, the QMS) stay outside it.

import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export const sha256 = value => createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");
// Stable JSON: object keys sorted, so the same content always hashes the same.
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
}
export const newId = prefix => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

export function dataDir(root) {
  return process.env.REGCHAIN_DATA_DIR || join(root, ".regchain-data");
}
export function databasePath(root) {
  return process.env.REGCHAIN_DB || join(dataDir(root), "regchain.db");
}

// Each migration runs once, in order, inside a transaction. Never edit one that has shipped: add a new one.
const MIGRATIONS = [
  {
    id: 1,
    name: "initial schema",
    sql: `
CREATE TABLE source (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, authority TEXT NOT NULL, jurisdiction TEXT NOT NULL, tier INTEGER NOT NULL,
  kind TEXT NOT NULL, url TEXT, status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE source_version (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES source(id), edition TEXT, retrieved_at TEXT NOT NULL,
  raw_sha256 TEXT NOT NULL, normalized_sha256 TEXT NOT NULL, text TEXT NOT NULL, origin TEXT NOT NULL,
  UNIQUE (source_id, raw_sha256)
);
CREATE TABLE evidence_span (
  id TEXT PRIMARY KEY, source_version_id TEXT NOT NULL REFERENCES source_version(id), evidence_key TEXT NOT NULL,
  locator TEXT NOT NULL, text TEXT NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, span_sha256 TEXT NOT NULL,
  UNIQUE (source_version_id, evidence_key)
);
CREATE TABLE change_case (
  id TEXT PRIMARY KEY, case_key TEXT NOT NULL UNIQUE, jurisdiction TEXT NOT NULL, topic TEXT NOT NULL, requirement_key TEXT NOT NULL,
  fingerprint TEXT, old_version_id TEXT REFERENCES source_version(id), new_version_id TEXT REFERENCES source_version(id),
  classification TEXT NOT NULL, detected_at TEXT NOT NULL, correlation_id TEXT NOT NULL,
  state TEXT NOT NULL, state_version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE proposal (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES change_case(id), revision INTEGER NOT NULL, source TEXT NOT NULL,
  payload TEXT NOT NULL, payload_sha256 TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (case_id, revision)
);
CREATE TABLE decision (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES change_case(id), proposal_id TEXT REFERENCES proposal(id), revision INTEGER NOT NULL,
  outcome TEXT NOT NULL, rationale TEXT NOT NULL, actor TEXT NOT NULL, role TEXT NOT NULL, decided_at TEXT NOT NULL
);
CREATE TABLE requirement_version (
  id TEXT PRIMARY KEY, requirement_key TEXT NOT NULL, number INTEGER NOT NULL, prior_id TEXT REFERENCES requirement_version(id),
  body TEXT NOT NULL, applicable_from TEXT, in_force_from TEXT, evidence_ids TEXT NOT NULL, case_id TEXT REFERENCES change_case(id),
  decision_id TEXT REFERENCES decision(id), receipt TEXT, published_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'in_force'
);
CREATE UNIQUE INDEX requirement_version_number ON requirement_version (requirement_key, number) WHERE status = 'in_force';
CREATE TABLE specification_version (
  id TEXT PRIMARY KEY, country TEXT NOT NULL, version INTEGER NOT NULL, sections TEXT NOT NULL, published_at TEXT NOT NULL,
  case_id TEXT REFERENCES change_case(id), decision_id TEXT REFERENCES decision(id), status TEXT NOT NULL DEFAULT 'in_force'
);
CREATE UNIQUE INDEX specification_version_number ON specification_version (country, version) WHERE status = 'in_force';
CREATE TABLE portfolio_snapshot (
  id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, imported_at TEXT NOT NULL, data TEXT NOT NULL
);
CREATE TABLE impact_assessment (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES change_case(id), rule_version TEXT NOT NULL,
  portfolio_snapshot_id TEXT NOT NULL REFERENCES portfolio_snapshot(id), prepared_at TEXT NOT NULL, summary TEXT NOT NULL
);
CREATE TABLE impact_finding (
  id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL REFERENCES impact_assessment(id), object_type TEXT NOT NULL, object_id TEXT NOT NULL,
  result TEXT NOT NULL, impact TEXT NOT NULL, rationale TEXT NOT NULL, inputs TEXT NOT NULL, evidence_keys TEXT NOT NULL
);
CREATE TABLE action (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES change_case(id), decision_id TEXT REFERENCES decision(id), target TEXT NOT NULL,
  owner TEXT NOT NULL, due_on TEXT, status TEXT NOT NULL, scope TEXT NOT NULL, receipt TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE change_decision (
  change_id TEXT PRIMARY KEY, decision TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, decided_at TEXT NOT NULL
);
CREATE TABLE shipment_action (
  shipment_id TEXT PRIMARY KEY, action TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TABLE session (
  id TEXT PRIMARY KEY, role TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL
);
CREATE TABLE idempotency_key (
  key TEXT PRIMARY KEY, scope TEXT NOT NULL, request_sha256 TEXT NOT NULL, status INTEGER NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE replay_run (
  id TEXT PRIMARY KEY, fixture_set TEXT NOT NULL, extraction_mode TEXT NOT NULL, analysis_date TEXT NOT NULL, started_at TEXT NOT NULL,
  finished_at TEXT, status TEXT NOT NULL, comparison TEXT, case_ids TEXT, error TEXT
);
CREATE TABLE audit_entry (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, occurred_at TEXT NOT NULL, actor TEXT NOT NULL, role TEXT,
  type TEXT NOT NULL, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, detail TEXT NOT NULL, data TEXT NOT NULL,
  correlation_id TEXT, causation_id TEXT, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE TRIGGER audit_entry_no_update BEFORE UPDATE ON audit_entry BEGIN SELECT RAISE(ABORT, 'audit entries are append-only'); END;
CREATE TRIGGER audit_entry_no_delete BEFORE DELETE ON audit_entry BEGIN SELECT RAISE(ABORT, 'audit entries are append-only'); END;
CREATE TABLE outbox_event (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, schema_version INTEGER NOT NULL, occurred_at TEXT NOT NULL,
  producer TEXT NOT NULL, tenant_id TEXT NOT NULL, aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, aggregate_version INTEGER NOT NULL,
  correlation_id TEXT NOT NULL, causation_id TEXT, evidence_ids TEXT NOT NULL, data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, dispatched_at TEXT
);
CREATE TABLE qms_receipt (
  event_id TEXT PRIMARY KEY REFERENCES outbox_event(id), action_id TEXT NOT NULL, received_at TEXT NOT NULL
);
CREATE INDEX audit_subject ON audit_entry (subject_type, subject_id, seq);
CREATE INDEX outbox_status ON outbox_event (status, seq);
CREATE INDEX finding_assessment ON impact_finding (assessment_id);
`,
  },
  {
    id: 2,
    name: "users, sessions with expiry, sign-in attempts, agent plan approvals",
    sql: `
CREATE TABLE app_user (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL,
  password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, password_changed_at TEXT NOT NULL, last_sign_in TEXT
);
ALTER TABLE session ADD COLUMN user_id TEXT REFERENCES app_user(id);
ALTER TABLE session ADD COLUMN expires_at TEXT;
CREATE TABLE login_attempt (key TEXT NOT NULL, at TEXT NOT NULL, ok INTEGER NOT NULL);
CREATE INDEX login_attempt_key ON login_attempt (key, at);
CREATE TABLE agent_approval (
  shipment_id TEXT PRIMARY KEY, option_id TEXT NOT NULL, title TEXT NOT NULL, actions TEXT NOT NULL, after TEXT,
  approved_by TEXT NOT NULL, role TEXT, approved_at TEXT NOT NULL, run_at TEXT, mode TEXT, drafts TEXT NOT NULL
);
`,
  },
];

const handles = new Map();

// Open (or reuse) the database for a root folder and bring its schema up to date.
export function openDatabase(root, { path } = {}) {
  const file = path ?? databasePath(root);
  if (handles.has(file)) return handles.get(file);
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  handles.set(file, db);
  return db;
}
export function closeDatabase(root, { path } = {}) {
  const file = path ?? databasePath(root);
  handles.get(file)?.close();
  handles.delete(file);
}

function migrate(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migration (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const done = new Set(db.prepare("SELECT id FROM schema_migration").all().map(row => row.id));
  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    transaction(db, () => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migration (id, name, applied_at) VALUES (?, ?, ?)").run(migration.id, migration.name, new Date().toISOString());
    });
  }
}
export const schemaVersion = db => db.prepare("SELECT MAX(id) AS id FROM schema_migration").get().id;

// Run work atomically: everything commits together or nothing does.
export function transaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// ---------- Audit trail: append-only, each entry chained to the one before by its hash ----------
const GENESIS = "0".repeat(64);
function entryHash(entry) {
  const { seq, hash, ...content } = entry;
  return sha256(canonical(content));
}
export function appendAudit(db, { actor, role = null, type, subjectType, subjectId, detail = "", data = {}, correlationId = null, causationId = null, at = new Date().toISOString() }) {
  const prev = db.prepare("SELECT hash FROM audit_entry ORDER BY seq DESC LIMIT 1").get()?.hash ?? GENESIS;
  const entry = { id: newId("aud"), occurred_at: at, actor, role, type, subject_type: subjectType, subject_id: subjectId, detail: String(detail ?? ""),
    data: canonical(data), correlation_id: correlationId, causation_id: causationId, prev_hash: prev };
  entry.hash = entryHash(entry);
  db.prepare(`INSERT INTO audit_entry (id, occurred_at, actor, role, type, subject_type, subject_id, detail, data, correlation_id, causation_id, prev_hash, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(entry.id, entry.occurred_at, entry.actor, entry.role, entry.type, entry.subject_type, entry.subject_id,
    entry.detail, entry.data, entry.correlation_id, entry.causation_id, entry.prev_hash, entry.hash);
  return entry;
}
// Recompute the chain. Any edited, inserted or removed entry breaks it at that point.
export function verifyAudit(db) {
  let prev = GENESIS;
  let count = 0;
  for (const row of db.prepare("SELECT * FROM audit_entry ORDER BY seq").all()) {
    count++;
    if (row.prev_hash !== prev || entryHash(row) !== row.hash) return { ok: false, entries: count, brokenAt: row.seq, id: row.id };
    prev = row.hash;
  }
  return { ok: true, entries: count, head: prev };
}
export function auditFor(db, subjectType, subjectId) {
  return db.prepare("SELECT * FROM audit_entry WHERE subject_type = ? AND subject_id = ? ORDER BY seq").all(subjectType, subjectId)
    .map(row => ({ ...row, data: JSON.parse(row.data) }));
}

// ---------- Event outbox: persisted with the change, delivered afterwards, at least once ----------
export function addOutboxEvent(db, { type, aggregateType, aggregateId, aggregateVersion, correlationId, causationId = null, evidenceIds = [], data = {}, at = new Date().toISOString() }) {
  const id = newId("evt");
  db.prepare(`INSERT INTO outbox_event (id, type, schema_version, occurred_at, producer, tenant_id, aggregate_type, aggregate_id, aggregate_version,
    correlation_id, causation_id, evidence_ids, data) VALUES (?, ?, 1, ?, 'regchain', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, type, at, process.env.REGCHAIN_TENANT || "default", aggregateType, aggregateId, aggregateVersion, correlationId, causationId, JSON.stringify(evidenceIds), JSON.stringify(data));
  return id;
}
export function eventEnvelope(row) {
  return { event_id: row.id, type: row.type, schema_version: row.schema_version, occurred_at: row.occurred_at, producer: row.producer, tenant_id: row.tenant_id,
    aggregate_type: row.aggregate_type, aggregate_id: row.aggregate_id, aggregate_version: row.aggregate_version, correlation_id: row.correlation_id,
    causation_id: row.causation_id, evidence_ids: JSON.parse(row.evidence_ids), data: JSON.parse(row.data),
    dispatch: { status: row.status, attempts: row.attempts, last_error: row.last_error, dispatched_at: row.dispatched_at } };
}

// ---------- Idempotency: a retried command returns the first result; a different request under the same key is refused ----------
export function rememberedResponse(db, key, scope, request) {
  if (!key) return null;
  const row = db.prepare("SELECT * FROM idempotency_key WHERE key = ?").get(key);
  if (!row) return null;
  if (row.scope !== scope || row.request_sha256 !== sha256(canonical(request))) {
    throw Object.assign(new Error("This Idempotency-Key was already used for a different request."), { statusCode: 409 });
  }
  return { status: row.status, body: JSON.parse(row.response) };
}
export function rememberResponse(db, key, scope, request, status, body) {
  if (!key) return;
  db.prepare("INSERT OR IGNORE INTO idempotency_key (key, scope, request_sha256, status, response, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(key, scope, sha256(canonical(request)), status, JSON.stringify(body), new Date().toISOString());
}
