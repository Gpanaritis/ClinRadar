// RegChain's settings: when the official sources are checked, what happens after a check, and the connections the
// agents may use. The audit trail is the store. The current value is the latest recorded change, so every change
// keeps who made it, when and what it was, in the same hash-chained trail as the cases and the approvals.
//
// Credentials are not settings. Keys and cloud identities stay in the server's .env file or the cloud's own identity
// and never pass through the page. A new company-system connection starts as a request: the Quality owner approves
// it, and the agents use it only after a developer builds it and it is validated like any other connection.

import { appendAudit, openDatabase, transaction } from "./db.mjs";

export const MONITORING_DEFAULTS = Object.freeze({ enabled: true, frequency: "weekdays", every: 7, weekday: 1, time: "06:00", onBlocked: "notify" });
const FREQUENCIES = ["daily", "weekdays", "weekly", "interval"];
const ON_BLOCKED = ["notify", "plan"];
const ACCESS = ["read-only", "draft-only"];
const TYPES = ["settings.monitoring_changed", "connection.requested", "connection.approved", "connection.rejected"];
// Who may change what. Any role may request a connection.
export const SETTINGS_ROLES = { monitoring: ["reviewer", "owner"], decide: ["owner"] };

const refuse = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const text = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// A complete, valid monitoring setting, or an error that says what is wrong.
export function cleanMonitoring(input = {}) {
  const value = { ...MONITORING_DEFAULTS, ...input };
  if (typeof value.enabled !== "boolean") throw refuse(422, "Say whether checks run automatically.");
  if (!FREQUENCIES.includes(value.frequency)) throw refuse(422, "Choose how often the checks run.");
  if (!Number.isInteger(value.every) || value.every < 1 || value.every > 365) throw refuse(422, "Repeat every 1 to 365 days.");
  if (!Number.isInteger(value.weekday) || value.weekday < 1 || value.weekday > 7) throw refuse(422, "Choose a day of the week.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) throw refuse(422, "Give the time as HH:MM.");
  if (!ON_BLOCKED.includes(value.onBlocked)) throw refuse(422, "Choose what happens when a shipment is blocked.");
  const { enabled, frequency, every, weekday, time, onBlocked } = value;
  return { enabled, frequency, every, weekday, time, onBlocked };
}

function cleanRequest(input = {}) {
  const request = {
    name: text(input.name, 60),
    holds: text(input.holds, 200),
    address: text(input.address, 200),
    access: input.access,
    owner: text(input.owner, 80),
    reason: text(input.reason, 400),
  };
  if (request.name.length < 2) throw refuse(422, "Name the system.");
  if (request.holds.length < 3) throw refuse(422, "Say what the agents would read there.");
  if (!ACCESS.includes(request.access)) throw refuse(422, "A connection is read-only or draft-only. No connection can change a validated system.");
  if (request.address && !/^(https:\/\/|stdio:)/i.test(request.address)) throw refuse(422, "The MCP server address starts with https:// or stdio:.");
  if (request.owner.length < 2) throw refuse(422, "Name the business owner of the system.");
  return request;
}

// The current settings, the connection requests and the latest changes.
export function readSettings(root) {
  const db = openDatabase(root);
  const rows = db.prepare(`SELECT * FROM audit_entry WHERE type IN (${TYPES.map(() => "?").join(", ")}) ORDER BY seq`).all(...TYPES);
  let monitoring = { ...MONITORING_DEFAULTS };
  let changed = null;
  const connections = new Map();
  for (const row of rows) {
    const data = JSON.parse(row.data);
    if (row.type === "settings.monitoring_changed") {
      monitoring = cleanMonitoring(data.monitoring);
      changed = { at: row.occurred_at, by: row.actor };
    } else if (row.type === "connection.requested") {
      connections.set(row.subject_id, { id: row.subject_id, ...data.request, status: "requested", requestedBy: row.actor, requestedAt: row.occurred_at });
    } else if (connections.has(row.subject_id)) {
      Object.assign(connections.get(row.subject_id), { status: row.type === "connection.approved" ? "approved" : "rejected", decidedBy: row.actor, decidedAt: row.occurred_at, note: data.note ?? "" });
    }
  }
  const log = rows.slice(-20).reverse().map(row => ({ at: row.occurred_at, by: row.actor, event: row.type, detail: row.detail }));
  return { monitoring, changed, connections: [...connections.values()], log };
}

const describeMonitoring = value => {
  if (!value.enabled) return "Automatic checks paused";
  const days = ["", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
  const when = { daily: "every day", weekdays: "on weekdays", weekly: "on " + days[value.weekday], interval: value.every === 1 ? "every day" : "every " + value.every + " days" }[value.frequency];
  return `Checks ${when} at ${value.time} Athens time; ${value.onBlocked === "plan" ? "agents prepare plans for blocked shipments" : "blocked shipments are shown, no agent run"}`;
};

export function saveMonitoring(root, input, { by, role }) {
  if (!SETTINGS_ROLES.monitoring.includes(role)) throw refuse(403, "The Regulatory SME or the Quality owner changes the monitoring schedule.");
  const monitoring = cleanMonitoring(input);
  const db = openDatabase(root);
  const before = readSettings(root).monitoring;
  if (JSON.stringify(before) === JSON.stringify(monitoring)) return readSettings(root);
  transaction(db, () => appendAudit(db, { actor: by, role, type: "settings.monitoring_changed", subjectType: "settings", subjectId: "monitoring", detail: describeMonitoring(monitoring), data: { monitoring, before } }));
  return readSettings(root);
}

export function requestConnection(root, input, { by, role }) {
  if (!role) throw refuse(401, "Choose a role first.");
  const request = cleanRequest(input);
  const db = openDatabase(root);
  const current = readSettings(root).connections;
  if (current.some(item => item.status !== "rejected" && item.name.toLowerCase() === request.name.toLowerCase())) throw refuse(409, `A request for ${request.name} is already recorded.`);
  const id = "conn-" + (current.length + 1);
  transaction(db, () => appendAudit(db, { actor: by, role, type: "connection.requested", subjectType: "connection", subjectId: id, detail: `${request.name} · requested, ${request.access}`, data: { request } }));
  return readSettings(root);
}

export function decideConnection(root, { id, decision, note }, { by, role }) {
  if (!SETTINGS_ROLES.decide.includes(role)) throw refuse(403, "The Quality owner approves new connections.");
  if (!["approved", "rejected"].includes(decision)) throw refuse(422, "Approve or reject the request.");
  const reason = text(note, 400);
  if (decision === "rejected" && reason.length < 3) throw refuse(422, "Say why the request is rejected.");
  const request = readSettings(root).connections.find(item => item.id === id);
  if (!request) throw refuse(404, "There is no such connection request.");
  if (request.status !== "requested") throw refuse(409, `This request was already ${request.status}.`);
  // Four eyes: someone else approves. Turning down one's own request is allowed; it withdraws it.
  if (decision === "approved" && request.requestedBy === by) throw refuse(409, "The person who asked for a connection cannot also approve it.");
  const db = openDatabase(root);
  transaction(db, () => appendAudit(db, { actor: by, role, type: "connection." + decision, subjectType: "connection", subjectId: id, detail: `${request.name} · ${decision}`, data: { note: reason } }));
  return readSettings(root);
}
