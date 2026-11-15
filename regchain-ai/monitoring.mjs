// SupplyShield's monitoring decisions: which recommended countries a person has turned on, and whether the authoritative
// active-trial portfolio (the CTMS) is connected. As with the settings, the audit trail is the store: the current value is
// the latest recorded change, so every change keeps who made it, when, why and what it was.
//
// Countries with an operationally active trial are not stored here: they are monitored because the portfolio says so.
// Decisions recorded before this workspace (supply-network.json, monitoring_decisions) apply until the workspace is emptied.

import { appendAudit, openDatabase, transaction } from "./db.mjs";
import { MONITORING_KINDS, MONITORING_ROLES } from "./supplyshield.mjs";

const TYPES = ["scope.monitoring_changed", "scope.recommendation_reviewed", "scope.portfolio_connected", "scope.portfolio_disconnected", "scope.workspace_emptied"];
const refuse = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const text = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const ROLE_NAMES = { viewer: "Clinical Supply", reviewer: "the Regulatory SME" };

export function readScopeState(root, network) {
  const db = openDatabase(root);
  const rows = db.prepare(`SELECT * FROM audit_entry WHERE type IN (${TYPES.map(() => "?").join(", ")}) ORDER BY seq`).all(...TYPES);
  let choices = {};
  for (const item of network?.monitoring_decisions ?? []) choices[`${item.country}|${item.kind}`] = { enabled: Boolean(item.enabled), by: item.by, role: item.role, at: item.at, reason: item.reason ?? "", recorded: true };
  let connected = network?.ctms?.connected !== false;
  let changedAt = null;
  for (const row of rows) {
    const data = JSON.parse(row.data);
    if (row.type === "scope.workspace_emptied") { choices = {}; connected = false; }
    else if (row.type === "scope.portfolio_connected") connected = true;
    else if (row.type === "scope.portfolio_disconnected") connected = false;
    else if (row.type === "scope.monitoring_changed") choices[`${data.country}|${data.kind}`] = { enabled: Boolean(data.enabled), by: row.actor, role: row.role, at: row.occurred_at, reason: data.reason ?? "" };
    else if (row.type === "scope.recommendation_reviewed") choices[`${data.country}|review`] = { dismissed: data.decision === "dismiss", by: row.actor, role: row.role, at: row.occurred_at, reason: data.reason ?? "" };
    changedAt = row.occurred_at;
  }
  const log = rows.slice(-30).reverse().map(row => ({ at: row.occurred_at, by: row.actor, event: row.type, detail: row.detail }));
  return { choices, connected, changedAt, log };
}

// Turn monitoring on or off for one recommended country. `allowed` is the list of current recommendations: countries
// with an active trial are always monitored and cannot be switched here.
export function setMonitoring(root, network, { country, kind, enabled, reason }, { by, role, allowed, names = {} }) {
  if (!MONITORING_KINDS[kind]) throw refuse(422, "Choose external-risk or regulatory and customs monitoring.");
  if (typeof enabled !== "boolean") throw refuse(422, "Say whether monitoring is on or off.");
  const code = text(country, 2).toUpperCase();
  if (!allowed.includes(code)) throw refuse(409, `${names[code] ?? code} is not a recommended country. Countries with an active trial are monitored automatically.`);
  if (!role) throw refuse(401, "Choose a role first.");
  if (role !== MONITORING_ROLES[kind]) throw refuse(403, `${ROLE_NAMES[MONITORING_ROLES[kind]].replace(/^./, letter => letter.toUpperCase())} turns ${MONITORING_KINDS[kind].toLowerCase()} monitoring on or off.`);
  const why = text(reason, 300);
  if (why.length < 3) throw refuse(422, "Say why, in a few words. It is kept with the decision.");
  const before = readScopeState(root, network).choices[`${code}|${kind}`];
  if (Boolean(before?.enabled) === enabled) return readScopeState(root, network);
  const db = openDatabase(root);
  transaction(db, () => appendAudit(db, { actor: by, role, type: "scope.monitoring_changed", subjectType: "country", subjectId: code,
    detail: `${names[code] ?? code} · ${MONITORING_KINDS[kind]} monitoring ${enabled ? "on" : "off"} · ${why}`, data: { country: code, kind, enabled, reason: why } }));
  return readScopeState(root, network);
}

// Dismiss a recommendation (with a reason) or bring it back. A dismissed country is never monitored; it stays listed,
// folded, with who dismissed it and why. Clinical Supply and the Regulatory SME review recommendations.
export function reviewRecommendation(root, network, { country, decision, reason }, { by, role, allowed, names = {} }) {
  if (!["dismiss", "restore"].includes(decision)) throw refuse(422, "Dismiss or restore the recommendation.");
  const code = text(country, 2).toUpperCase();
  if (!allowed.includes(code)) throw refuse(409, `${names[code] ?? code} is not a recommended country.`);
  if (!role) throw refuse(401, "Choose a role first.");
  if (!["viewer", "reviewer"].includes(role)) throw refuse(403, "Clinical Supply or the Regulatory SME reviews recommended countries.");
  const why = text(reason, 300);
  if (decision === "dismiss" && why.length < 3) throw refuse(422, "Say why, in a few words. It is kept with the decision.");
  const state = readScopeState(root, network);
  if (decision === "dismiss" && (state.choices[`${code}|external`]?.enabled || state.choices[`${code}|regulatory`]?.enabled)) throw refuse(409, "Turn its monitoring off before dismissing a country.");
  if (Boolean(state.choices[`${code}|review`]?.dismissed) === (decision === "dismiss")) return state;
  const db = openDatabase(root);
  transaction(db, () => appendAudit(db, { actor: by, role, type: "scope.recommendation_reviewed", subjectType: "country", subjectId: code,
    detail: `${names[code] ?? code} · recommendation ${decision === "dismiss" ? "dismissed" : "restored"}${why ? " · " + why : ""}`, data: { country: code, decision, reason: why } }));
  return readScopeState(root, network);
}

export function setPortfolioConnection(root, network, connected, { by, role }) {
  const current = readScopeState(root, network).connected;
  if (current === connected) return readScopeState(root, network);
  const db = openDatabase(root);
  transaction(db, () => appendAudit(db, { actor: by ?? "SupplyShield", role: role ?? null, type: connected ? "scope.portfolio_connected" : "scope.portfolio_disconnected", subjectType: "portfolio", subjectId: network?.ctms?.system ?? "CTMS",
    detail: connected ? `${network?.ctms?.system ?? "CTMS"} connected, read-only: the active-trial portfolio sets the monitoring scope` : `${network?.ctms?.system ?? "CTMS"} disconnected: the monitoring scope cannot be determined`, data: { connected } }));
  return readScopeState(root, network);
}

// An empty workspace for a rehearsal: no portfolio connected and no monitoring decisions. The earlier decisions stay in
// the audit trail.
export function emptyScope(root, { by }) {
  const db = openDatabase(root);
  transaction(db, () => appendAudit(db, { actor: by ?? "SupplyShield", type: "scope.workspace_emptied", subjectType: "portfolio", subjectId: "workspace",
    detail: "Workspace emptied: portfolio disconnected, monitoring decisions cleared (kept in this trail)", data: {} }));
}
