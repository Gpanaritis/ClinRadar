// One ClinRadar check, the same whether a person presses "Run the check" or the scheduler starts it.
//
// kind "check":      the official regulatory sources, the live feeds, the matching and the alerts (the full check).
// kind "poll":       the live feeds and the alerts only, between full checks.
// kind "regulatory": the official regulatory sources and the alerts only.
//
// Every run writes one audit entry with what it read, what it found and how many alerts it raised.

import { fetchFeeds, saveFeeds } from "./feeds.mjs";
import { loadData } from "./rules.mjs";
import { appendAudit, newId, openDatabase, transaction } from "./db.mjs";
import { raiseAndDeliver } from "./alerts.mjs";

const KINDS = ["check", "poll", "regulatory"];

export async function runCheck({ root, api, alerts: alertSettings = {}, kind = "check", reason = "manual", actor = "ClinRadar", role = null, origin = null, send } = {}) {
  if (!KINDS.includes(kind)) throw Object.assign(new Error("Unknown kind of check."), { statusCode: 400 });
  const checkId = newId("chk");
  const startedAt = new Date().toISOString();
  const data = await loadData(root);
  if (!data.network) throw Object.assign(new Error("The supply network data is missing."), { statusCode: 500 });
  const codes = data.supplyshield?.scope?.monitored?.external ?? [];
  const work = [];
  let feeds = null;
  let regulatory = null;
  if (kind !== "regulatory") work.push(fetchFeeds({ codes, geography: data.network.geography, today: data.today }).then(async result => { feeds = await saveFeeds(root, result); feeds.answered = result; }));
  if (kind !== "poll" && api?.checkRegulatorySources) work.push(api.checkRegulatorySources({ actor, role }).then(result => { regulatory = result; }).catch(error => { regulatory = { error: error.message }; }));
  await Promise.all(work);
  const after = await loadData(root);
  const counts = after.supplyshield?.counts ?? { confirmed: 0, potential: 0, observed: 0, clear: 0 };
  const db = openDatabase(root);
  const failed = feeds ? Object.values(feeds.answered.fcdo).filter(item => !item.ok).length : 0;
  const alerts = await raiseAndDeliver(db, after, alertSettings, { checkId, origin, send, actor: actor ?? "ClinRadar" });
  const what = kind === "poll" ? `Feeds polled between checks for ${codes.length} monitored countries` :
    kind === "regulatory" ? "Official regulatory sources read between checks" : `Official feeds checked for ${codes.length} monitored countries`;
  const sent = alerts.deliveries.filter(item => item.status === "sent").length;
  const detail = `${what}${failed ? ` (${failed} did not answer)` : ""}; ${counts.confirmed} confirmed disruptions, ${counts.potential} potential exposures, ${counts.observed} observed events` +
    (alerts.raised ? `; ${alerts.raised} new alert${alerts.raised === 1 ? "" : "s"} for Clinical Supply${sent ? `, sent on ${sent} channel${sent === 1 ? "" : "s"}` : ""}` : "");
  transaction(db, () => appendAudit(db, { actor: actor ?? "ClinRadar", role, type: "supplyshield.checked", subjectType: "monitoring", subjectId: feeds?.fetchedAt ?? startedAt, detail,
    data: { kind, reason, check: checkId, countries: codes, failed, gdacs: feeds ? Boolean(feeds.answered.gdacs?.ok) : null, counts,
      regulatory: regulatory ? { read: regulatory.read ?? 0, changed: regulatory.changed ?? [], failed: regulatory.failed ?? [], error: regulatory.error ?? null } : null,
      alerts: { raised: alerts.raised, critical: alerts.critical, deliveries: alerts.deliveries } } }));
  return { checkId, kind, reason, at: startedAt, counts, failed, regulatory, alerts };
}
