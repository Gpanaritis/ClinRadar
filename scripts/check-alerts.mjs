// Checks the alerts to Clinical Supply and the server's own schedule, without network or AI calls:
// - what raises an alert, and what the alert says (the evidence, the patients as a count, the sources, the next step);
// - an alert is raised once; a match that becomes confirmed is a new one; a rehearsal archives them;
// - email through a stand-in SMTP server on this computer (the conversation, the headers, the body, dot-stuffing, no
//   password without encryption) and a chat webhook in the Teams, Slack and JSON formats;
// - a delivery that fails is tried again at the next check, up to five times, and every step is in the audit trail;
// - a whole check (feeds, regulatory sources, matching, alerts) with every official site unreachable;
// - the schedule in Athens time (weekdays, summer time), what is due when, a missed check, a pause, and a back-off.
// Usage: node scripts/check-alerts.mjs     (runs in a temporary data folder; nothing on this computer changes)

import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "alerts-check-"));
process.env.REGCHAIN_DATA_DIR = join(temp, "data");
process.env.REGCHAIN_CACHE_DIR = join(temp, "cache");

// No official site is reachable in this check: only this computer answers.
const realFetch = globalThis.fetch;
let outside = 0;
globalThis.fetch = async (url, options) => {
  if (/^http:\/\/127\.0\.0\.1:/.test(String(url))) return realFetch(url, options);
  outside++;
  throw new Error("offline (check-alerts)");
};

const { loadData } = await import("../regchain-ai/rules.mjs");
const { openDatabase, closeDatabase, verifyAudit } = await import("../regchain-ai/db.mjs");
const { loadConfig } = await import("../regchain-ai/config.mjs");
const notify = await import("../regchain-ai/notify.mjs");
const alerts = await import("../regchain-ai/alerts.mjs");
const { runCheck } = await import("../regchain-ai/check.mjs");
const { createApi } = await import("../regchain-ai/api.mjs");
const scheduler = await import("../regchain-ai/scheduler.mjs");
const { startFresh } = await import("../regchain-ai/approvals.mjs");

const ORIGIN = "http://127.0.0.1:4173";
const auditTypes = db => db.prepare("SELECT type FROM audit_entry ORDER BY seq").all().map(row => row.type);

// 1. Where alerts go: each channel says what it still needs; nothing secret comes back.
{
  const none = notify.channelStatus(loadConfig({}).alerts);
  assert.equal(none.any, false, "with nothing set, alerts are shown in ClinRadar only");
  assert.equal(none.email.configured, false);
  const partial = notify.channelStatus(loadConfig({ REGCHAIN_ALERT_EMAIL_TO: "supply@example.com" }).alerts);
  assert.ok(partial.email.configured && !partial.email.ready);
  assert.ok(partial.email.problems.some(problem => /REGCHAIN_SMTP_HOST/.test(problem)) && partial.email.problems.some(problem => /REGCHAIN_SMTP_FROM/.test(problem)), "it names what is missing");
  const plainRemote = notify.channelStatus(loadConfig({ REGCHAIN_ALERT_EMAIL_TO: "a@example.com", REGCHAIN_SMTP_HOST: "mail.example.com", REGCHAIN_SMTP_FROM: "clinradar@example.com", REGCHAIN_SMTP_SECURITY: "none" }).alerts);
  assert.ok(plainRemote.email.problems.some(problem => /only for a mail relay on this computer/.test(problem)), "unencrypted mail only to a relay on this computer");
  const noPassword = notify.channelStatus(loadConfig({ REGCHAIN_ALERT_EMAIL_TO: "a@example.com", REGCHAIN_SMTP_HOST: "mail.example.com", REGCHAIN_SMTP_FROM: "c@example.com", REGCHAIN_SMTP_USER: "c" }).alerts);
  assert.ok(noPassword.email.problems.some(problem => /REGCHAIN_SMTP_PASSWORD/.test(problem)));
  const ready = notify.channelStatus(loadConfig({ REGCHAIN_ALERT_EMAIL_TO: "a@example.com; b@example.com", REGCHAIN_SMTP_HOST: "mail.example.com", REGCHAIN_SMTP_FROM: "c@example.com", REGCHAIN_SMTP_USER: "c", REGCHAIN_SMTP_PASSWORD: "secret-value" }).alerts);
  assert.ok(ready.email.ready && ready.any);
  assert.deepEqual(ready.email.recipients, ["a@example.com", "b@example.com"]);
  assert.equal(ready.email.port, 587, "STARTTLS on 587 by default");
  assert.ok(!JSON.stringify(ready).includes("secret-value"), "the SMTP password never leaves the server");
  assert.ok(notify.channelStatus(loadConfig({ REGCHAIN_ALERT_WEBHOOK_URL: "http://hooks.example.com/x" }).alerts).webhook.problems.some(problem => /https/.test(problem)), "a webhook needs https");
  assert.ok(notify.channelStatus(loadConfig({ REGCHAIN_ALERT_WEBHOOK_URL: "https://x.example.com/h", REGCHAIN_ALERT_WEBHOOK_FORMAT: "fax" }).alerts).webhook.problems.length);
  assert.ok(notify.channelStatus(loadConfig({ REGCHAIN_ALERT_WEBHOOK_URL: "https://x.example.com/h", REGCHAIN_ALERT_WEBHOOK_FORMAT: "teams" }).alerts).webhook.ready);
  assert.equal(loadConfig({}).scheduler, true, "the server schedule is on by default");
  assert.equal(loadConfig({ REGCHAIN_SCHEDULER: "off" }).scheduler, false);
  console.log("ok  channels: email and webhook each say what they still need; unencrypted mail only to a local relay; https webhooks; the password never leaves the server");
}

// 2. What raises an alert, and what it says.
const data = await loadData(root);
const candidates = alerts.alertCandidates(data, { origin: ORIGIN });
{
  assert.deepEqual(candidates.map(item => item.key), [
    "external|SIG-BE-STRIKE-1124|SHP-IL-01|confirmed",
    "external|SIG-ENT-ERS-26-114-0042|SHP-ES-08|potential",
    "external|SIG-ENT-ERS-26-114-0042|SHP-ES-10|potential",
    "external|SIG-IL-TLV-0104|SHP-IL-02|potential",
    "regulatory|RC-UK-001|SHP-01,SHP-02,SHP-04,SHP-05,SHP-06,SHP-07,SHP-08,SHP-09",
    "regulatory|RC-ES-001|SHP-ES-05,SHP-ES-06,SHP-ES-07,SHP-ES-08,SHP-ES-09,SHP-ES-10",
    "regulatory|RC-IL-001|SHP-IL-02,SHP-IL-03",
  ], "every confirmed disruption, potential exposure and rule change holding shipments; no observed event and nothing not affected");
  const strike = candidates[0];
  assert.equal(strike.priority, "CRITICAL", "14 patients would go 2 days without treatment");
  const text = strike.lines.join("\n");
  assert.match(text, /Confirmed by EMEA specialty courier booking system, recorded 14 Nov 2026, 08:10 UTC/, "the record that confirmed it, with its time");
  assert.match(text, /14 patients on treatment at Tel Aviv; the site's stock lasts until 27 Nov 2026/, "the patients behind it, as a count");
  assert.match(text, /2 days without treatment/);
  assert.match(text, /Sources: Brussels Airport operational notice, 13 Nov 2026, 16:00 UTC; Belgian Federal Public Service Mobility and Transport notice/, "every source, with its time");
  assert.match(text, /Owner: Clinical Supply/);
  assert.equal(strike.link, ORIGIN + "/?signal=SIG-BE-STRIKE-1124");
  assert.ok(strike.illustrative, "an invented event is marked as illustrative");
  const runway = candidates.find(item => item.sourceId === "SIG-IL-TLV-0104");
  assert.match(runway.lines.join(" "), /Not confirmed yet:/, "a potential exposure says what is missing");
  assert.equal(candidates.find(item => item.sourceId === "RC-UK-001").illustrative, false, "the UK rule is real");
  assert.equal(candidates.find(item => item.sourceId === "RC-ES-001").illustrative, true, "the Spanish rule is not");
  assert.deepEqual(alerts.alertCandidates({ ...data, supplyshield: { ...data.supplyshield, scope: { status: "undetermined" } } }), [], "no portfolio, no scope, no alert");
  console.log("ok  candidates: 1 confirmed disruption (CRITICAL, courier record, 14 patients, stock until 27 Nov), 3 potential exposures with what is missing, 3 rule changes holding shipments; sources and times on each; illustrative ones marked");
}

// 3. Raised once; a higher tier is a new alert.
const db = openDatabase(root);
{
  const first = alerts.recordAlerts(db, candidates, { checkId: "chk_1" });
  assert.equal(first.length, 7);
  assert.equal(alerts.recordAlerts(db, candidates, { checkId: "chk_2" }).length, 0, "the same items are not raised again");
  const escalated = { ...candidates[1], key: candidates[1].key.replace("|potential", "|confirmed"), tier: "confirmed", priority: "HIGH" };
  assert.equal(alerts.recordAlerts(db, [escalated], { checkId: "chk_3" }).length, 1, "a potential exposure that becomes confirmed is a new alert");
  assert.equal(auditTypes(db).filter(type => type === "alert.raised").length, 8, "each alert is in the audit trail");
  const digest = alerts.buildDigest(db.prepare("SELECT * FROM alert").all().map(row => ({ ...row, lines: JSON.parse(row.lines), raisedAt: row.raised_at, illustrative: Boolean(row.illustrative) })), { origin: ORIGIN });
  assert.match(digest.subject, /^\[CRITICAL\] ClinRadar: 2 confirmed disruptions, 3 potential exposures, 3 rule changes holding shipments$/, "the earlier potential alert stays on record next to the confirmed one");
  assert.match(digest.text.split("\n")[2], /^1\. CRITICAL · Confirmed disruption · SHP-IL-01/, "most urgent first");
  assert.ok(!/Ms\.|Mr\.|patient [A-Z]/.test(digest.text), "no patient-level data");
  console.log("ok  once each: the same check raises nothing new, a confirmed match is a new alert, every alert is audited; the message puts the CRITICAL one first");
}

// 4. Email through a stand-in mail server on this computer.
function fakeSmtp({ starttls = false, auth = false, refuseRecipient = false } = {}) {
  const sessions = [];
  const server = net.createServer(socket => {
    const session = { commands: [], data: "" };
    sessions.push(session);
    let inData = false;
    let buffer = "";
    socket.write("220 fake.local ESMTP\r\n");
    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
      let at;
      while ((at = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (inData) {
          if (line === ".") { inData = false; socket.write("250 2.0.0 queued as TEST1\r\n"); } else session.data += line + "\r\n";
          continue;
        }
        session.commands.push(line);
        const verb = line.split(" ")[0].toUpperCase();
        if (verb === "EHLO") socket.write("250-fake.local\r\n" + (starttls ? "250-STARTTLS\r\n" : "") + (auth ? "250-AUTH PLAIN LOGIN\r\n" : "") + "250 8BITMIME\r\n");
        else if (verb === "MAIL") socket.write("250 OK\r\n");
        else if (verb === "RCPT") socket.write(refuseRecipient ? "550 5.1.1 No such user\r\n" : "250 OK\r\n");
        else if (verb === "DATA") { inData = true; socket.write("354 go ahead\r\n"); }
        else if (verb === "QUIT") { socket.write("221 bye\r\n"); socket.end(); }
        else socket.write("502 not here\r\n");
      }
    });
    socket.on("error", () => {});
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, sessions, port: server.address().port })));
}
const decodeBody = raw => {
  const [head, body] = raw.split("\r\n\r\n");
  return { head, text: Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8") };
};
{
  const smtp = await fakeSmtp();
  const settings = { host: "127.0.0.1", port: smtp.port, security: "none", user: "", password: "", from: "clinradar@example.com" };
  const text = "Line one\n.leading dot line\nPatients: 14 on treatment · stock until 27 Nov 2026";
  const sent = await notify.sendMail(settings, { to: ["supply@example.com", "lead@example.com"], subject: "[CRITICAL] ClinRadar: 1 confirmed disruption · Tel Aviv", text });
  assert.match(sent.accepted, /queued as TEST1/);
  const session = smtp.sessions[0];
  assert.deepEqual(session.commands.slice(0, 5).map(line => line.split(" ")[0]), ["EHLO", "MAIL", "RCPT", "RCPT", "DATA"], "the SMTP conversation");
  assert.equal(session.commands[1], "MAIL FROM:<clinradar@example.com>");
  assert.equal(session.commands[2], "RCPT TO:<supply@example.com>");
  const { head, text: body } = decodeBody(session.data);
  assert.match(head, /^From: ClinRadar <clinradar@example\.com>$/m);
  assert.match(head, /^To: supply@example\.com, lead@example\.com$/m);
  assert.match(head, /^Subject: =\?UTF-8\?B\?/m, "a subject with non-ASCII characters is encoded");
  assert.match(head, /^Auto-Submitted: auto-generated$/m);
  assert.equal(body, text.replace(/\n/g, "\r\n"), "the body arrives exactly as written");
  assert.match(notify.buildMessage({ from: "a@example.com", to: ["b@example.com"], subject: "x\r\nBcc: evil@example.com", text: "y" }), /^Subject: x Bcc: evil@example\.com$/m, "no header can be injected through a subject");
  await assert.rejects(notify.sendMail({ ...settings, user: "u", password: "p" }, { to: ["supply@example.com"], subject: "s", text: "t" }), /never sent without encryption/, "no password over a plain connection");
  await assert.rejects(notify.sendMail({ ...settings, security: "starttls" }, { to: ["supply@example.com"], subject: "s", text: "t" }), /does not offer STARTTLS/, "STARTTLS is required when asked for");
  await assert.rejects(notify.sendMail({ ...settings, host: "mail.example.com" }, { to: ["a@example.com"], subject: "s", text: "t" }), /only allowed to a relay on this computer/);
  smtp.server.close();
  const refusing = await fakeSmtp({ refuseRecipient: true });
  await assert.rejects(notify.sendMail({ ...settings, port: refusing.port }, { to: ["nobody@example.com"], subject: "s", text: "t" }), /refused the recipient nobody@example\.com: 550/, "the server's own words when it refuses");
  refusing.server.close();
  console.log("ok  email: EHLO, MAIL, RCPT, DATA to a stand-in server; headers and an encoded subject, the body exactly as written, no header injection; no password without encryption, STARTTLS enforced, refusals quoted");
}

// 5. The chat webhook, in its three formats, and deliveries that fail and are tried again.
function fakeWebhook() {
  const received = [];
  let failures = 0;
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      received.push({ path: request.url, type: request.headers["content-type"], body: JSON.parse(body) });
      if (failures > 0) { failures--; response.writeHead(503).end("busy"); } else response.writeHead(200).end("ok");
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, received, url: `http://127.0.0.1:${server.address().port}/hook`, failNext: count => { failures = count; } })));
}
{
  const hook = await fakeWebhook();
  const digest = alerts.buildDigest(candidates.slice(0, 2).map((item, index) => ({ ...item, id: "a" + index, raisedAt: "2026-11-15T04:00:00Z" })), { origin: ORIGIN });
  await notify.postWebhook({ url: hook.url, format: "teams" }, digest);
  const card = hook.received[0].body;
  assert.equal(card.type, "message");
  assert.equal(card.attachments[0].contentType, "application/vnd.microsoft.card.adaptive", "Teams gets an Adaptive Card");
  assert.match(card.attachments[0].content.body[1].text, /\*\*CRITICAL · Confirmed disruption · SHP-IL-01/);
  await notify.postWebhook({ url: hook.url, format: "slack" }, digest);
  assert.deepEqual(Object.keys(hook.received[1].body), ["text"], "Slack gets text");
  await notify.postWebhook({ url: hook.url, format: "json" }, digest);
  assert.equal(hook.received[2].body.alerts.length, 2, "JSON gets every alert as data");
  assert.equal(hook.received[2].body.alerts[0].shipment, "SHP-IL-01");

  // Deliveries: one message per channel per check; a failure is tried again at the next check, up to five times.
  const smtp = await fakeSmtp();
  const settings = loadConfig({ REGCHAIN_ALERT_EMAIL_TO: "supply@example.com", REGCHAIN_SMTP_HOST: "127.0.0.1", REGCHAIN_SMTP_PORT: String(smtp.port), REGCHAIN_SMTP_SECURITY: "none",
    REGCHAIN_SMTP_FROM: "clinradar@example.com", REGCHAIN_ALERT_WEBHOOK_URL: hook.url, REGCHAIN_ALERT_WEBHOOK_FORMAT: "json" }).alerts;
  const rows = db.prepare("SELECT * FROM alert ORDER BY rowid").all().map(row => ({ id: row.id }));
  assert.equal(alerts.queueDeliveries(db, rows, notify.channelStatus(settings), { checkId: "chk_1" }), 2, "one delivery for email, one for the webhook");
  hook.failNext(1);
  const firstTry = await alerts.deliverPending(db, settings, { origin: ORIGIN });
  assert.deepEqual(firstTry.map(item => `${item.channel}:${item.status}`), ["email:sent", "webhook:retry"]);
  assert.equal(smtp.sessions.length, 1, "one email for all the alerts of the check");
  assert.match(decodeBody(smtp.sessions[0].data).text, /ClinRadar found 8 new items that touch our shipments/);
  const secondTry = await alerts.deliverPending(db, settings, { origin: ORIGIN });
  assert.deepEqual(secondTry.map(item => `${item.channel}:${item.status}`), ["webhook:sent"], "tried again at the next check; the email is not sent twice");
  alerts.queueDeliveries(db, rows.slice(0, 1), notify.channelStatus(settings), { checkId: "chk_4" });
  db.prepare("UPDATE alert_delivery SET status = 'sent' WHERE channel = 'email' AND status = 'pending'").run();
  hook.failNext(10);
  let last;
  for (let attempt = 0; attempt < 6; attempt++) last = await alerts.deliverPending(db, settings, { origin: ORIGIN });
  assert.equal(db.prepare("SELECT status, attempts FROM alert_delivery WHERE check_id = 'chk_4' AND channel = 'webhook'").get().status, "failed", "after five attempts it is marked failed");
  assert.equal(db.prepare("SELECT attempts FROM alert_delivery WHERE check_id = 'chk_4' AND channel = 'webhook'").get().attempts, 5);
  assert.deepEqual(last, [], "a failed delivery is not tried a sixth time");
  const types = auditTypes(db);
  assert.ok(types.includes("alert.delivered") && types.filter(type => type === "alert.delivery_failed").length === 6, "every delivery and every failure is audited");
  const summary = alerts.alertsSummary(db, settings);
  assert.equal(summary.counts.failed, 1);
  assert.ok(summary.recent[0].deliveries.length >= 1, "the page sees what happened to each delivery");
  assert.ok(!JSON.stringify(summary).includes("REGCHAIN_SMTP_PASSWORD") && summary.channels.email.ready && summary.channels.webhook.ready);
  hook.failNext(0);
  const test = await alerts.sendTestAlert(db, settings, { origin: ORIGIN, by: "P. Laine · Clinical Supply", role: "viewer" });
  assert.deepEqual(test.map(item => `${item.channel}:${item.ok}`), ["email:true", "webhook:true"]);
  assert.match(decodeBody(smtp.sessions.at(-1).data).text, /This is a test from ClinRadar/);
  assert.ok(auditTypes(db).includes("alert.test_sent"));
  await assert.rejects(alerts.sendTestAlert(db, loadConfig({}).alerts, { by: "x" }), /No alert channel is set up yet/);
  smtp.server.close();
  hook.server.close();
  console.log("ok  webhook: Teams Adaptive Card, Slack text, JSON with every alert; one message per channel per check; a failure is tried again at the next check and marked failed after five attempts; test alerts; all audited");
}

// 6. A whole check, with every official site unreachable, then a rehearsal that starts again.
{
  closeDatabase(root);
  await rm(join(temp, "data"), { recursive: true, force: true });
  const fresh = openDatabase(root);
  const api = createApi({ root, config: loadConfig({}) });
  const hook = await fakeWebhook();
  const settings = loadConfig({ REGCHAIN_ALERT_WEBHOOK_URL: hook.url, REGCHAIN_ALERT_WEBHOOK_FORMAT: "slack" }).alerts;
  const before = outside;
  const first = await runCheck({ root, api, alerts: settings, kind: "check", reason: "scheduled", actor: "ClinRadar scheduler", origin: ORIGIN });
  assert.ok(outside > before, "the check tried the official sites");
  assert.deepEqual(first.counts, { observed: 13, potential: 2, confirmed: 1, clear: 0 }, "a site that does not answer keeps its last good copy: the results stand");
  assert.equal(first.regulatory.read, 0, "no regulatory source answered");
  assert.equal(first.regulatory.failed.length, 4, "all four are named as not answering");
  assert.equal(first.alerts.raised, 7);
  assert.deepEqual(first.alerts.deliveries.map(item => item.status), ["sent"]);
  assert.match(hook.received[0].body.text, /^\[CRITICAL\] ClinRadar|ClinRadar found 7 new items/m);
  const entry = fresh.prepare("SELECT * FROM audit_entry WHERE type = 'supplyshield.checked' ORDER BY seq DESC LIMIT 1").get();
  // 17 countries with Belgium; the UK has no FCDO page of its own, so 16 FCDO requests went unanswered.
  assert.match(entry.detail, /Official feeds checked for 17 monitored countries \(16 did not answer\); 1 confirmed disruptions, 2 potential exposures, 13 observed events; 7 new alerts for Clinical Supply, sent on 1 channel/);
  const entryData = JSON.parse(entry.data);
  assert.equal(entryData.kind, "check");
  assert.equal(entryData.reason, "scheduled");
  const regulatory = fresh.prepare("SELECT detail FROM audit_entry WHERE type = 'regulatory_sources.checked' ORDER BY seq DESC LIMIT 1").get();
  assert.match(regulatory.detail, /^0 of 4 official regulatory sources read; no change since the stored versions; 4 did not answer, the last good copy is kept$/);
  const poll = await runCheck({ root, api, alerts: settings, kind: "poll", reason: "poll", actor: "ClinRadar scheduler", origin: ORIGIN });
  assert.equal(poll.alerts.raised, 0, "a poll that finds nothing new raises nothing");
  assert.equal(poll.regulatory, null, "a feed poll does not read the regulatory sources");
  assert.equal(hook.received.length, 1, "and sends nothing");
  const last = scheduler.lastRuns(fresh);
  assert.equal(last.check.reason, "scheduled");
  assert.ok(last.pollAt >= last.check.at && last.regulatoryAt);
  await startFresh(root, { plans: false, by: "Start fresh link" });
  const again = await runCheck({ root, api, alerts: settings, kind: "check", reason: "manual", actor: "P. Laine · Clinical Supply", role: "viewer", origin: ORIGIN });
  assert.equal(again.alerts.raised, 7, "after a rehearsal starts again, the same items raise their alerts again");
  assert.equal(fresh.prepare("SELECT COUNT(*) AS n FROM alert").get().n, 14, "the archived alerts are kept");
  assert.ok(verifyAudit(fresh).ok, "the audit chain is intact");
  hook.server.close();
  console.log("ok  whole check offline: feeds and regulatory sources fail, the last good copies stand, 7 alerts raised and sent; a poll raises nothing new; the audit entry says it all; a rehearsal raises them again");
}

// 7. The schedule, in Athens time.
{
  const weekdays = { enabled: true, frequency: "weekdays", every: 7, weekday: 1, time: "06:00", onBlocked: "notify" };
  const at = iso => Date.parse(iso);
  assert.equal(new Date(scheduler.nextCheckAt(weekdays, at("2026-11-14T10:00:00Z"))).toISOString(), "2026-11-16T04:00:00.000Z", "Saturday: next check Monday 06:00 Athens (UTC+2)");
  assert.equal(new Date(scheduler.nextCheckAt({ ...weekdays, frequency: "daily" }, at("2027-03-27T12:00:00Z"))).toISOString(), "2027-03-28T03:00:00.000Z", "summer time: 06:00 Athens is 03:00 UTC");
  assert.equal(new Date(scheduler.nextCheckAt({ ...weekdays, frequency: "weekly", weekday: 3 }, at("2026-11-16T05:00:00Z"))).toISOString(), "2026-11-18T04:00:00.000Z", "weekly on Wednesday");
  assert.equal(new Date(scheduler.nextCheckAt({ ...weekdays, frequency: "interval", every: 3 }, at("2026-11-16T05:00:00Z"), at("2026-11-16T04:00:00Z"))).toISOString(), "2026-11-19T04:00:00.000Z", "every 3 days from the last scheduled check");
  assert.equal(scheduler.nextCheckAt({ ...weekdays, enabled: false }, Date.now()), null);
  const cadence = { pollMinutes: 30, regulatoryHours: 24 };
  const now = at("2026-11-16T09:00:00Z");
  const recent = { check: { at: at("2026-11-16T04:00:00Z") }, scheduledAt: at("2026-11-16T04:00:00Z"), pollAt: at("2026-11-16T08:45:00Z"), regulatoryAt: at("2026-11-16T04:00:00Z") };
  assert.equal(scheduler.dueJob(weekdays, recent, cadence, now, now - 3600000), null, "nothing due 15 minutes after a poll");
  assert.equal(scheduler.dueJob(weekdays, { ...recent, pollAt: at("2026-11-16T08:29:00Z") }, cadence, now, now - 3600000), "poll", "the feeds every 30 minutes");
  assert.equal(scheduler.dueJob(weekdays, { ...recent, regulatoryAt: at("2026-11-15T08:00:00Z") }, cadence, now, now - 3600000), "regulatory", "the regulatory sources every 24 hours");
  assert.equal(scheduler.dueJob(weekdays, { ...recent, check: { at: at("2026-11-13T04:00:00Z") } }, cadence, now, now - 60000), "check", "a check missed while the server was off runs at once");
  assert.equal(scheduler.dueJob({ ...weekdays, enabled: false }, { check: null, pollAt: null, regulatoryAt: null }, cadence, now, now - 86400000), null, "a paused schedule pauses the polls too");
  assert.equal(scheduler.dueJob(weekdays, { check: null, pollAt: null, regulatoryAt: null }, cadence, now, now - 60000), null, "a first start waits for the schedule");

  let clock = at("2026-11-16T09:00:00Z");
  const ran = [];
  let fail = true;
  const last = { check: { at: at("2026-11-13T04:00:00Z") }, scheduledAt: null, pollAt: clock, regulatoryAt: clock };
  const instance = scheduler.createScheduler({ readMonitoring: () => weekdays, lastRuns: () => last, cadence, now: () => clock, logger: { error: () => {} },
    run: async job => { ran.push(job); if (fail) throw new Error("boom"); last.check = { at: clock, reason: "scheduled" }; return {}; } });
  assert.equal((await instance.tick()).job, "check");
  assert.equal(await instance.tick(), null, "after a failure it waits");
  clock += 5 * 60000 + 1;
  fail = false;
  assert.equal((await instance.tick()).job, "check", "and tries again five minutes later");
  assert.equal(await instance.tick(), null, "then nothing until the next slot");
  const status = instance.status();
  assert.equal(status.nextCheckAt, "2026-11-17T04:00:00.000Z");
  assert.equal(status.upcoming.length, 3);
  assert.deepEqual(ran, ["check", "check"]);
  console.log("ok  schedule: Athens time across summer time, weekdays, weekly and every N days; feeds every 30 minutes, regulatory sources every 24 hours, a missed check at once, a pause stops everything, a failed run waits five minutes");
}

globalThis.fetch = realFetch;
closeDatabase(root);
await rm(temp, { recursive: true, force: true }).catch(() => {});
console.log("All alert and schedule checks passed.");
