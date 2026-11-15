// Alerts to Clinical Supply. After every check, ClinRadar raises an alert for each new thing that touches our shipments:
//
// - a confirmed disruption or a potential exposure on a shipment's route (an external event matched by place and day);
// - a rule change that holds planned shipments until the Regulatory SME decides;
// - an import approval that no longer covers a shipment.
//
// Each alert carries its evidence: the event, the shipment and leg, the record that confirmed it (or what is still
// missing and who must confirm it), the number of patients behind it, the sources with their times, and the next step.
// An alert is raised once. The same match at a higher tier (potential, then confirmed) is a new alert.
//
// All the alerts of one check go out together, as one message per channel (email, chat webhook). A message that could not
// be delivered is tried again at the next check, up to five times. Every alert and every delivery is in the audit trail.

import { appendAudit, newId, transaction } from "./db.mjs";
import { watchBriefs } from "./rules.mjs";
import { channelStatus, postWebhook, sendMail } from "./notify.mjs";

const PRIORITY = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
const TIER = { confirmed: "Confirmed disruption", potential: "Potential exposure", held: "Shipments held by a rule change", permit: "Import approval problem", test: "Test" };
const TIER_ORDER = { confirmed: 0, held: 1, permit: 2, potential: 3, test: 4 };
const MAX_ATTEMPTS = 5;

const day = value => new Date(String(value).slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const stamp = value => {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? String(value) : `${day(at.toISOString())}, ${at.toISOString().slice(11, 16)} UTC`;
};
const sentence = text => {
  const value = String(text ?? "").trim();
  return !value ? "" : /[.!?]$/.test(value) ? value : value + ".";
};

// Everything that should be an alert right now, from the data as it is after a check.
export function alertCandidates(data, { origin = null } = {}) {
  const ss = data.supplyshield;
  if (!ss || ss.scope?.status !== "determined") return [];
  const name = code => ss.names?.[code] ?? code;
  const link = id => (origin ? `${origin}/?signal=${encodeURIComponent(id)}` : origin);
  const out = [];
  for (const signal of ss.signals ?? []) {
    for (const match of signal.matches ?? []) {
      if (!["confirmed", "potential"].includes(match.tier)) continue;
      const lines = [sentence(`${match.label} on ${day(match.date)}: ${match.effect ?? ""}`)];
      if (match.tier === "confirmed" && match.evidence) {
        lines.push(sentence(`Confirmed by ${match.evidence.source}, recorded ${stamp(match.evidence.recordedAt)}: ${match.evidence.detail ?? match.evidence.status}`));
      } else if (match.missing) {
        lines.push(sentence(`Not confirmed yet: ${match.missing}`));
      }
      const impact = match.impact;
      if (impact?.patients || match.buffer?.runsOutOn) {
        const who = impact?.patients ? `${impact.patients} patients on treatment at ${match.site}` : `The site in ${match.site}`;
        const runs = (impact?.runsOutOn ?? match.buffer?.runsOutOn) ? `; the site's stock lasts until ${day(impact?.runsOutOn ?? match.buffer.runsOutOn)}` : "";
        const nothing = impact?.ifNothingDone;
        const after = !nothing ? "" : nothing.daysWithoutTreatment > 0
          ? ` If nothing is done, the next free flight (${day(nothing.rebookedFlight)}) delivers on ${day(nothing.delivery)}: ${nothing.daysWithoutTreatment} day${nothing.daysWithoutTreatment === 1 ? "" : "s"} without treatment.`
          : ` If nothing is done, the next free flight (${day(nothing.rebookedFlight)}) still delivers on ${day(nothing.delivery)}, before the stock runs out.`;
        lines.push(`Patients: ${who}${runs}.${after}`);
      }
      const sources = (signal.sources?.length ? signal.sources : [{ authority: signal.authority, publishedAt: signal.publishedAt, url: signal.url }])
        .map(source => [source.authority, source.publishedAt ? stamp(source.publishedAt) : "", source.url ?? ""].filter(Boolean).join(", "));
      lines.push(`Sources: ${sources.join("; ")}.`);
      lines.push(sentence(`Next: ${match.next ?? "Review the signal."}${match.owner ? ` Owner: ${match.owner}` : ""}`));
      out.push({
        key: `external|${signal.id}|${match.shipment}|${match.tier}`, kind: "external", sourceId: signal.id, shipment: match.shipment, tier: match.tier,
        priority: match.priority ?? (match.tier === "confirmed" ? "HIGH" : "LOW"),
        heading: `${match.priority ?? ""} · ${TIER[match.tier]} · ${match.shipment} to ${match.site} (${name(match.country)})`.replace(/^ · /, ""),
        title: signal.title, lines, link: link(signal.id), illustrative: Boolean(signal.illustrative),
      });
    }
  }
  const scenario = { ES: data.spain?.note, IL: data.israel?.note };
  for (const item of watchBriefs(data).regulatory ?? []) {
    if (!item.touching?.length) continue;
    const held = [...item.touching].sort();
    if (item.kind === "change") {
      out.push({
        key: `regulatory|${item.id}|${held.join(",")}`, kind: "regulatory", sourceId: item.id, shipment: null, tier: "held", priority: "HIGH",
        heading: `HIGH · ${TIER.held} · ${held.length} shipment${held.length === 1 ? "" : "s"} (${name(item.country)})`, title: item.title,
        lines: [
          `Applies from ${day(item.effective)}. ${held.length} planned shipment${held.length === 1 ? " does" : "s do"} not meet it yet and ${held.length === 1 ? "is" : "are"} held: ${held.join(", ")}.`,
          "Evidence: the official texts and the evidence passages are on the change's case in ClinRadar.",
          "Next: the Regulatory SME decides on the change in ClinRadar; Clinical Supply replans the held shipments. Owner: Regulatory SME.",
        ],
        link: origin, illustrative: /FICTIONAL|illustrative/i.test(String(scenario[item.country] ?? "")),
      });
    } else {
      out.push({
        key: `regulatory|${item.id}|${held.join(",")}|${item.result}`, kind: "regulatory", sourceId: item.id, shipment: item.shipment ?? held[0], tier: "permit",
        priority: item.result === "Fail" ? "HIGH" : "MEDIUM",
        heading: `${item.result === "Fail" ? "HIGH" : "MEDIUM"} · ${TIER.permit} · ${held.join(", ")} (${name(item.country)})`, title: item.title,
        lines: [sentence(item.status), item.validUntil ? `Valid until ${day(item.validUntil)}.` : "", "Next: correct the shipment or ask the importer of record for an amended approval. Owner: Clinical Supply."].filter(Boolean),
        link: origin, illustrative: false,
      });
    }
  }
  return out;
}

// Store the new alerts of one check (those not already raised and still open). Returns the stored rows.
export function recordAlerts(db, candidates, { checkId, at = new Date().toISOString(), actor = "ClinRadar" }) {
  const open = new Set(db.prepare("SELECT alert_key FROM alert WHERE archived_at IS NULL").all().map(row => row.alert_key));
  const seen = new Set();
  const fresh = candidates.filter(item => !open.has(item.key) && !seen.has(item.key) && seen.add(item.key));
  if (!fresh.length) return [];
  const rows = fresh.map(item => ({ id: newId("alr"), ...item, checkId, raisedAt: at }));
  transaction(db, () => {
    const insert = db.prepare(`INSERT INTO alert (id, alert_key, kind, source_id, shipment_id, tier, priority, heading, title, lines, link, illustrative, check_id, raised_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const row of rows) {
      insert.run(row.id, row.key, row.kind, row.sourceId, row.shipment, row.tier, row.priority, row.heading, row.title, JSON.stringify(row.lines), row.link, row.illustrative ? 1 : 0, checkId, at);
      appendAudit(db, { actor, type: "alert.raised", subjectType: "alert", subjectId: row.id, detail: `${row.heading}: ${row.title}`, at,
        data: { key: row.key, source: row.sourceId, shipment: row.shipment, tier: row.tier, priority: row.priority, check: checkId, illustrative: row.illustrative } });
    }
  });
  return rows;
}

const fromRow = row => ({ id: row.id, key: row.alert_key, kind: row.kind, sourceId: row.source_id, shipment: row.shipment_id, tier: row.tier, priority: row.priority,
  heading: row.heading, title: row.title, lines: JSON.parse(row.lines), link: row.link, illustrative: Boolean(row.illustrative), checkId: row.check_id, raisedAt: row.raised_at });

// One message for a group of alerts: most urgent first.
export function buildDigest(alerts, { origin = null, at = new Date().toISOString(), test = false } = {}) {
  const sorted = [...alerts].sort((a, b) => (PRIORITY[b.priority] ?? 0) - (PRIORITY[a.priority] ?? 0) || (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || String(a.raisedAt).localeCompare(String(b.raisedAt)));
  const count = tier => sorted.filter(item => item.tier === tier).length;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    count("confirmed") && plural(count("confirmed"), "confirmed disruption", "confirmed disruptions"),
    count("potential") && plural(count("potential"), "potential exposure", "potential exposures"),
    count("held") && plural(count("held"), "rule change holding shipments", "rule changes holding shipments"),
    count("permit") && plural(count("permit"), "import approval problem", "import approval problems"),
  ].filter(Boolean);
  const critical = sorted.some(item => item.priority === "CRITICAL");
  const subject = test ? "ClinRadar: test alert" : `${critical ? "[CRITICAL] " : ""}ClinRadar: ${parts.join(", ") || plural(sorted.length, "new alert", "new alerts")}`;
  const items = sorted.map(item => ({
    heading: item.heading,
    lines: [item.title, ...item.lines, ...(item.illustrative ? ["Illustrative scenario: this event or rule is invented for the demonstration."] : []), ...(item.link ? [`Open in ClinRadar: ${item.link}`] : [])],
  }));
  const intro = test ? "This is a test from ClinRadar. Alerts to Clinical Supply will arrive here." :
    `ClinRadar found ${plural(sorted.length, "new item", "new items")} that touch our shipments (check of ${stamp(at)}).`;
  const footer = `Nothing changes in any system until a person approves it in ClinRadar. Sent by ClinRadar${origin ? ` · ${origin}` : ""}.`;
  const text = [intro, "", ...items.flatMap((item, index) => [`${index + 1}. ${item.heading}`, ...item.lines.map(line => "   " + line), ""]), footer].join("\n");
  return { subject, text, items, footer, alerts: sorted.map(({ key, ...rest }) => rest) };
}

// Queue one delivery per ready channel for the alerts of a check.
export function queueDeliveries(db, alerts, channels, { checkId, at = new Date().toISOString() }) {
  if (!alerts.length) return 0;
  const ids = JSON.stringify(alerts.map(item => item.id));
  const targets = [];
  if (channels.email.ready) targets.push(["email", channels.email.recipients.join(", ")]);
  if (channels.webhook.ready) targets.push(["webhook", `${channels.webhook.format} · ${channels.webhook.host}`]);
  transaction(db, () => {
    const insert = db.prepare("INSERT INTO alert_delivery (id, check_id, channel, target, alert_ids, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)");
    for (const [channel, target] of targets) insert.run(newId("dlv"), checkId, channel, target, ids, at);
  });
  return targets.length;
}

// Send every delivery that is waiting (new, or to be tried again). Returns what happened to each.
export async function deliverPending(db, settings, { origin = null, send = {}, actor = "ClinRadar", now = () => new Date().toISOString() } = {}) {
  const channels = channelStatus(settings);
  const mail = send.mail ?? sendMail;
  const hook = send.webhook ?? postWebhook;
  const results = [];
  for (const row of db.prepare("SELECT * FROM alert_delivery WHERE status IN ('pending', 'retry') ORDER BY created_at, rowid").all()) {
    if (!channels[row.channel]?.ready) continue;
    const ids = JSON.parse(row.alert_ids);
    const alerts = db.prepare(`SELECT * FROM alert WHERE id IN (${ids.map(() => "?").join(", ")})`).all(...ids).map(fromRow);
    const digest = buildDigest(alerts, { origin, at: row.created_at });
    const at = now();
    try {
      if (row.channel === "email") await mail(settings.smtp, { to: settings.emailTo, subject: digest.subject, text: digest.text });
      else await hook(settings.webhook, digest);
      transaction(db, () => {
        db.prepare("UPDATE alert_delivery SET status = 'sent', attempts = attempts + 1, last_error = NULL, delivered_at = ? WHERE id = ?").run(at, row.id);
        appendAudit(db, { actor, type: "alert.delivered", subjectType: "alert_delivery", subjectId: row.id, at,
          detail: `${digest.subject} · ${row.channel === "email" ? "email to " : "webhook "}${row.target}`, data: { channel: row.channel, target: row.target, alerts: ids, attempt: row.attempts + 1 } });
      });
      results.push({ id: row.id, channel: row.channel, status: "sent", alerts: ids.length });
    } catch (error) {
      const attempts = row.attempts + 1;
      const status = attempts >= MAX_ATTEMPTS ? "failed" : "retry";
      const message = String(error.message ?? error).slice(0, 300);
      transaction(db, () => {
        db.prepare("UPDATE alert_delivery SET status = ?, attempts = ?, last_error = ? WHERE id = ?").run(status, attempts, message, row.id);
        appendAudit(db, { actor, type: "alert.delivery_failed", subjectType: "alert_delivery", subjectId: row.id, at,
          detail: `${row.channel === "email" ? "Email" : "Webhook"} not delivered (attempt ${attempts} of ${MAX_ATTEMPTS}): ${message}`, data: { channel: row.channel, target: row.target, alerts: ids, attempt: attempts, final: status === "failed" } });
      });
      results.push({ id: row.id, channel: row.channel, status, error: message, alerts: ids.length });
    }
  }
  return results;
}

// Raise and send the alerts for the data as it is now: the last step of every check.
export async function raiseAndDeliver(db, data, settings, { checkId, origin = null, send, actor = "ClinRadar", at = new Date().toISOString() }) {
  const raised = recordAlerts(db, alertCandidates(data, { origin }), { checkId, at, actor });
  queueDeliveries(db, raised, channelStatus(settings), { checkId, at });
  const deliveries = await deliverPending(db, settings, { origin, send, actor });
  return { raised: raised.length, critical: raised.filter(item => item.priority === "CRITICAL").length, deliveries };
}

// A test message to every ready channel, so the team sees where alerts arrive before the first real one.
export async function sendTestAlert(db, settings, { origin = null, send = {}, by, role = null }) {
  const channels = channelStatus(settings);
  if (!channels.any) throw Object.assign(new Error("No alert channel is set up yet. Set the email or webhook settings on the server (see RegChain-AI-Deployment.md)."), { statusCode: 409 });
  const digest = buildDigest([], { origin, test: true });
  const results = [];
  for (const channel of ["email", "webhook"]) {
    if (!channels[channel].ready) continue;
    try {
      if (channel === "email") await (send.mail ?? sendMail)(settings.smtp, { to: settings.emailTo, subject: digest.subject, text: digest.text });
      else await (send.webhook ?? postWebhook)(settings.webhook, digest);
      results.push({ channel, ok: true });
    } catch (error) {
      results.push({ channel, ok: false, error: String(error.message ?? error).slice(0, 300) });
    }
  }
  transaction(db, () => appendAudit(db, { actor: by ?? "ClinRadar", role, type: "alert.test_sent", subjectType: "alerts", subjectId: "test",
    detail: results.map(item => `${item.channel}: ${item.ok ? "delivered" : "not delivered (" + item.error + ")"}`).join("; "), data: { results } }));
  return results;
}

// Open alerts are archived when a rehearsal starts again, so the next check raises them anew. Nothing is deleted.
export function archiveAlerts(db, at = new Date().toISOString()) {
  const archived = db.prepare("UPDATE alert SET archived_at = ? WHERE archived_at IS NULL").run(at).changes;
  const cancelled = db.prepare("UPDATE alert_delivery SET status = 'cancelled' WHERE status IN ('pending', 'retry')").run().changes;
  return { archived, cancelled };
}

// What the page shows: where alerts go, the latest ones and what happened to each delivery.
export function alertsSummary(db, settings, { limit = 12 } = {}) {
  const channels = channelStatus(settings);
  // Newest first; within one check, the most urgent first.
  const recent = db.prepare(`SELECT * FROM alert WHERE archived_at IS NULL ORDER BY raised_at DESC,
    CASE priority WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC, rowid LIMIT ?`).all(limit).map(fromRow);
  const deliveries = db.prepare("SELECT * FROM alert_delivery ORDER BY created_at DESC, rowid DESC LIMIT 100").all();
  for (const alert of recent) {
    alert.deliveries = deliveries.filter(row => JSON.parse(row.alert_ids).includes(alert.id))
      .map(row => ({ channel: row.channel, status: row.status, attempts: row.attempts, error: row.last_error, at: row.delivered_at ?? row.created_at }));
  }
  const week = new Date(Date.now() - 7 * 86400000).toISOString();
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  return {
    channels,
    recent,
    counts: {
      open: count("SELECT COUNT(*) AS n FROM alert WHERE archived_at IS NULL"),
      week: count("SELECT COUNT(*) AS n FROM alert WHERE archived_at IS NULL AND raised_at >= ?", week),
      sent: count("SELECT COUNT(*) AS n FROM alert_delivery WHERE status = 'sent'"),
      waiting: count("SELECT COUNT(*) AS n FROM alert_delivery WHERE status IN ('pending', 'retry')"),
      failed: count("SELECT COUNT(*) AS n FROM alert_delivery WHERE status = 'failed'"),
    },
    lastSentAt: db.prepare("SELECT MAX(delivered_at) AS at FROM alert_delivery WHERE status = 'sent'").get().at ?? null,
  };
}
