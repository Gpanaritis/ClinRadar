// ClinRadar's scheduler: the server runs the checks on its own, whether or not anyone has the page open.
//
// - The full check runs on the monitoring schedule (Settings › Monitoring schedule, Athens time): the official regulatory
//   sources, the live feeds for every country monitored for external risk, the matching, and the alerts.
// - Between full checks, the feeds are polled every few minutes (weather_poll_minutes and disaster_poll_minutes in the
//   scope policy, config/supplyshield.yaml), and the regulatory sources are read again every regulatory_poll_hours.
//   A poll that finds something new raises its alerts at once.
// - A check missed while the server was down runs once when it starts again.
// - Pausing the schedule pauses all of it.
//
// What ran when is read back from the audit trail, so a restart knows where it was.

const DAY_MS = 86400000;
const athens = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });

// The same arithmetic as the page, so both always agree on the next check.
const athensParts = ms => Object.fromEntries(athens.formatToParts(new Date(ms)).map(part => [part.type, part.value]));
const athensDayOf = ms => { const parts = athensParts(ms); return `${parts.year}-${parts.month}-${parts.day}`; };
export function athensSlot(day, time) {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  const offset = at => { const parts = athensParts(at); return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) - Math.floor(at / 60000) * 60000; };
  return wall - offset(wall - offset(wall));
}
const shiftDay = (day, count) => new Date(Date.parse(day + "T12:00:00Z") + count * DAY_MS).toISOString().slice(0, 10);
const weekdayOf = day => (new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7 + 1;

// The next planned check after `after`. "Every N days" counts from the previous scheduled check when there is one.
export function nextCheckAt(settings, after = Date.now(), anchor = null) {
  if (!settings.enabled) return null;
  if (settings.frequency === "interval" && Number.isFinite(anchor)) {
    let day = athensDayOf(anchor), at;
    do { day = shiftDay(day, settings.every); at = athensSlot(day, settings.time); } while (at <= after);
    return at;
  }
  const today = athensDayOf(after);
  for (let index = 0; index <= 8; index++) {
    const day = shiftDay(today, index);
    const at = athensSlot(day, settings.time);
    const weekday = weekdayOf(day);
    if (at <= after || (settings.frequency === "weekdays" && weekday > 5) || (settings.frequency === "weekly" && weekday !== settings.weekday)) continue;
    return at;
  }
  return null;
}
export function upcomingChecks(settings, first, count = 3) {
  const runs = [];
  let at = first;
  while (at && runs.length < count) { runs.push(at); at = nextCheckAt(settings, at, settings.frequency === "interval" ? at : null); }
  return runs;
}

// When each kind of run last happened, from the audit trail.
export function lastRuns(db) {
  const rows = db.prepare("SELECT occurred_at, actor, data FROM audit_entry WHERE type = 'supplyshield.checked' ORDER BY seq DESC LIMIT 200").all()
    .map(row => ({ at: Date.parse(row.occurred_at), by: row.actor, ...JSON.parse(row.data) }));
  const full = rows.find(row => (row.kind ?? "check") === "check");
  const scheduled = rows.find(row => (row.kind ?? "check") === "check" && row.reason === "scheduled");
  const regulatory = db.prepare("SELECT occurred_at FROM audit_entry WHERE type = 'regulatory_sources.checked' ORDER BY seq DESC LIMIT 1").get();
  return {
    check: full ? { at: full.at, reason: full.reason ?? "manual", by: full.by, counts: full.counts ?? null } : null,
    scheduledAt: scheduled?.at ?? null,
    pollAt: rows[0]?.at ?? null,
    regulatoryAt: regulatory ? Date.parse(regulatory.occurred_at) : null,
  };
}

// What is due now, if anything: a full check first, then the regulatory sources, then the feeds.
export function dueJob(settings, last, cadence, now, startedAt) {
  if (!settings.enabled) return null;
  const checkAt = nextCheckAt(settings, last.check?.at ?? startedAt, settings.frequency === "interval" ? last.scheduledAt : null);
  if (checkAt !== null && checkAt <= now) return "check";
  if ((last.regulatoryAt ?? startedAt) + cadence.regulatoryHours * 3600000 <= now) return "regulatory";
  if ((last.pollAt ?? startedAt) + cadence.pollMinutes * 60000 <= now) return "poll";
  return null;
}

export function createScheduler({ readMonitoring, lastRuns: readLast, cadence, run, now = Date.now, tickMs = 30000, logger = null }) {
  const startedAt = now();
  let timer = null;
  let running = null;
  let backoffUntil = 0;
  let lastError = null;
  let lastJob = null;

  async function tick() {
    if (running || now() < backoffUntil) return null;
    let job;
    try {
      job = dueJob(readMonitoring(), readLast(), cadence, now(), startedAt);
    } catch (error) {
      lastError = { at: now(), message: error.message };
      return null;
    }
    if (!job) return null;
    running = job;
    try {
      const result = await run(job);
      lastJob = { job, at: now(), ok: true };
      lastError = null;
      return { job, result };
    } catch (error) {
      // A run that fails is tried again in five minutes, not on every tick.
      backoffUntil = now() + 5 * 60000;
      lastError = { at: now(), job, message: error.message };
      lastJob = { job, at: now(), ok: false };
      (logger?.error ?? console.error)("scheduled run failed", { job, error: error.stack ?? error.message });
      return { job, error };
    } finally {
      running = null;
    }
  }

  function status() {
    const settings = readMonitoring();
    const last = readLast();
    const checkAt = nextCheckAt(settings, last.check?.at ?? startedAt, settings.frequency === "interval" ? last.scheduledAt : null);
    const paused = !settings.enabled;
    const iso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
    return {
      on: true, paused, running, startedAt: iso(startedAt), schedule: settings,
      lastCheck: last.check ? { ...last.check, at: iso(last.check.at) } : null,
      nextCheckAt: paused ? null : iso(checkAt),
      upcoming: paused ? [] : upcomingChecks(settings, checkAt).map(iso),
      pollMinutes: cadence.pollMinutes, lastPollAt: iso(last.pollAt), nextPollAt: paused ? null : iso((last.pollAt ?? startedAt) + cadence.pollMinutes * 60000),
      regulatoryHours: cadence.regulatoryHours, lastRegulatoryAt: iso(last.regulatoryAt), nextRegulatoryAt: paused ? null : iso((last.regulatoryAt ?? startedAt) + cadence.regulatoryHours * 3600000),
      lastJob: lastJob ? { ...lastJob, at: iso(lastJob.at) } : null, lastError: lastError ? { ...lastError, at: iso(lastError.at) } : null,
    };
  }

  return {
    tick,
    status,
    start() {
      if (timer) return;
      timer = setInterval(() => { tick(); }, tickMs);
      timer.unref?.();
      // The first look shortly after start: this is when a missed check runs.
      setTimeout(() => { tick(); }, Math.min(5000, tickMs)).unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
  };
}
