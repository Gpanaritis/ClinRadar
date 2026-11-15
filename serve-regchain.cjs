"use strict";

const { createServer, get } = require("node:http");
const { readFileSync, existsSync } = require("node:fs");
const { readFile, writeFile, mkdir, appendFile } = require("node:fs/promises");
const { join, resolve, sep, extname } = require("node:path");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");

// A local .env file (ignored by git) can hold the Anthropic API key and REGCHAIN_* settings. It is read first, so the
// settings below see it; variables already set in the environment win.
const envFile = join(__dirname, ".env");
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    console.error("Could not read .env (" + error.message + ").");
  }
}

// Settings, security headers and logs (regchain-ai/config.mjs, security.mjs). Defaults serve one person on this computer.
const { loadConfig } = require("./regchain-ai/config.mjs");
const claude = require("./regchain-ai/claude.mjs");
const { securityHeaders, withNonce, newNonce, requestId, clientAddress, createLogger, createRateLimiter } = require("./regchain-ai/security.mjs");
let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const host = config.host;
const port = config.port;
const origin = config.publicOrigin ?? "http://" + (host === "0.0.0.0" ? "127.0.0.1" : host) + ":" + port;
const allowedOrigins = config.origins;
const logger = createLogger({ format: config.logFormat, level: config.logLevel });
const apiWriteLimit = createRateLimiter(config.writesPerMinute);
// The public contact form has its own, stricter limit per client address (REGCHAIN_CONTACTS_PER_HOUR).
const contactLimit = createRateLimiter(config.contactsPerHour, 3600000);
// With named users, the routes that start work belong to one role each, as in the user journeys.
const API_ROLES = {
  "/api/agent/run": ["viewer", "Clinical Supply runs the agents."],
  "/api/agent/portfolio-run": ["viewer", "Clinical Supply runs the agents."],
  "/api/agent/withdraw": ["viewer", "Clinical Supply withdraws supply plans."],
  "/api/ai/analyze": ["reviewer", "The Regulatory SME runs the AI check."],
};
const identity = "regchain-dashboard";
const dashboardHtml = readFileSync(join(__dirname, "RegChain-AI-Dashboard.html"), "utf8");
// Data the page gets as JSON inside data script tags: the trial portfolio for the UK case
// and the Spain scenario (note, trial and specification). The page carries a copy of both
// (scripts/embed-data.mjs) for when it is opened as a file; the server replaces that copy with
// the files as they are now, read on every request, so edited data shows on reload.
const dataFiles = [
  { id: "portfolio-data", file: join(__dirname, "demo-data", "uk-labelling-portfolio.json"), name: "Portfolio" },
  { id: "spain-data", file: join(__dirname, "demo-data", "spain-scenario.json"), name: "Spain scenario" },
  { id: "specifications-data", file: join(__dirname, "demo-data", "country-specifications.json"), name: "Country Specifications" },
  { id: "israel-data", file: join(__dirname, "demo-data", "israel-scenario.json"), name: "Israel scenario" },
];
function dashboardPage() {
  let page = dashboardHtml;
  for (const { id, file, name } of dataFiles) {
    try {
      const data = readFileSync(file, "utf8");
      JSON.parse(data);
      const tag = '<script id="' + id + '" type="application/json">' + data.replace(/</g, "\\u003c") + "</script>";
      const embedded = new RegExp('<script id="' + id + '" type="application/json">[\\s\\S]*?</script>');
      page = embedded.test(page) ? page.replace(embedded, () => tag) : page.replace('<script id="dashboard-data">', () => tag + "\n" + '<script id="dashboard-data">');
    } catch (error) {
      if (error.code !== "ENOENT") console.error(name + " not loaded: " + error.message);
    }
  }
  return Buffer.from(page);
}
// --open opens the dashboard in local mode; --open-site opens the public launch page (/site/) in either mode.
const openPath = process.argv.includes("--open-site") ? "/site/" : "/";
const wantBrowser = process.argv.includes("--open-site") || (process.argv.includes("--open") && config.auth === "local");

// The sign-in page of a shared deployment. The dashboard and its data are served only after sign-in.
function signInPage(nonce) {
  return Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ClinRadar | Sign in</title><link rel="icon" href="/site/assets/favicon.svg" type="image/svg+xml">
<style>:root{font:15px/1.5 Inter,"Segoe UI",sans-serif;color:#132446;background:#f5f8fc}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px}main{width:100%;max-width:380px;background:#fff;border:1px solid #e0e8f3;border-radius:12px;padding:28px;box-shadow:0 2px 5px #14356212}
h1{font-size:22px;margin:0 0 4px}p{color:#536683;margin:0 0 18px;font-size:14px}label{display:grid;gap:4px;font-size:12px;font-weight:700;color:#445b7c;margin-bottom:12px}input{font:inherit;padding:9px 10px;border:1px solid #d5e2f1;border-radius:8px}
button{width:100%;font:inherit;font-weight:700;color:#fff;background:#1a52d1;border:0;border-radius:8px;padding:10px;cursor:pointer}button:disabled{opacity:.6}#error{color:#9f2c42;font-size:13px;min-height:20px;margin:10px 0 0}
.foot{margin:18px 0 0;padding-top:14px;border-top:1px solid #e0e8f3;font-size:13px}.foot a{color:#1a52d1;font-weight:700}</style></head>
<body><main><h1>ClinRadar</h1><p>Sign in with your ClinRadar account.</p><form id="signin"><label>Username<input name="username" autocomplete="username" required maxlength="80"></label>
<label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="200"></label><button type="submit">Sign in</button><p id="error" role="alert"></p></form>
<p class="foot" id="no-signup">Accounts are set up by your administrator. There is no self sign-up. <a href="/site/">About ClinRadar</a></p></main>
<script nonce="${nonce}">document.getElementById("signin").addEventListener("submit",async event=>{event.preventDefault();const form=event.target;const button=form.querySelector("button");button.disabled=true;
try{const response=await fetch("/v1/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:form.username.value,password:form.password.value})});
const body=await response.json().catch(()=>({}));if(!response.ok) throw new Error(body.error||"Sign-in failed.");location.replace("/");}catch(error){document.getElementById("error").textContent=error.message;button.disabled=false;}});</script></body></html>`);
}

// The recorded company rule the UK AI draft is checked against (mirrors ukCase in the dashboard).
const RULE = { requirement: "GB/IMP_LABELING", effective: "2026-04-28" };

// Each case the AI can check: where its sources come from, its recorded rule and where its result is kept.
const CASES = {
  uk: {
    file: "analysis-latest.json",
    sources: async () => (await loadModule("sources.mjs")).loadSources(__dirname, { refresh: true }),
    rule: async () => RULE,
    diff: true,
  },
  es: {
    file: "analysis-es-latest.json",
    sources: async () => (await loadModule("spain.mjs")).loadSpainSources(__dirname),
    rule: async () => (await loadModule("spain.mjs")).spainRule(__dirname),
    diff: false,
  },
};
// Official pages a failed source check can be retried against, with the edition on record.
const RETRY_SOURCES = {
  list: {
    api: "https://www.gov.uk/api/content/government/publications/importing-investigational-medicinal-products-into-great-britain-from-approved-countries/list-of-approved-countries-for-clinical-trials-and-investigational-medicinal-products",
    edition: "2025-02-12",
  },
};
function caseFrom(url) {
  const id = new URL(url, origin).searchParams.get("case") || "uk";
  return Object.hasOwn(CASES, id) ? id : null;
}


let analysisRunning = false;

function openBrowser() {
  if (!wantBrowser || process.platform !== "win32") return;
  const browser = spawn("cmd.exe", ["/d", "/c", "start", "", origin + openPath], {
    stdio: "ignore",
    windowsHide: true
  });
  browser.on("error", () => console.error("Open " + origin + " in your browser."));
  browser.unref();
}

function sendJson(response, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    ...securityHeaders({ secure: config.secureCookies }),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": data.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-RegChain-Local": identity
  });
  response.end(data);
}

const loadModule = name => import(pathToFileURL(join(__dirname, "regchain-ai", name)).href);

// The MCP systems the agents can use, described once (started at launch, so the page doesn't wait for them).
let agentSystemsCache = null;
function agentSystems() {
  agentSystemsCache ??= (async () => {
    const { connectSystems, describeSystems, closeSystems } = await loadModule("agent.mjs");
    const systems = await connectSystems(__dirname);
    const described = describeSystems(systems);
    await closeSystems(systems);
    return described;
  })().catch(error => {
    agentSystemsCache = null;
    throw error;
  });
  return agentSystemsCache;
}

// One agent run, streamed to the page as server-sent events. Live runs call Claude; scripted runs do not.
let agentRunning = false;
async function streamAgentRun(request, response) {
  const site = request.headers["sec-fetch-site"];
  if (site && !["same-origin", "none"].includes(site)) {
    sendJson(response, 403, { error: "Requests from other sites are refused." });
    return;
  }
  const params = new URL(request.url, origin).searchParams;
  const shipment = params.get("shipment") || "";
  const mode = params.get("mode") === "live" ? "live" : "scripted";
  response.writeHead(200, { ...securityHeaders({ secure: config.secureCookies }), "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-RegChain-Local": identity });
  const fail = message => {
    response.write("event: failure\ndata: " + JSON.stringify({ error: message }) + "\n\n");
    response.end();
  };
  const { loadData, shipmentView } = await loadModule("rules.mjs");
  if (!shipmentView(await loadData(__dirname), shipment)) return fail("Unknown shipment.");
  const ai = mode === "live" ? await aiFor(request) : null;
  if (ai && !ai.ready) return fail(ai.message);
  if (agentRunning) return fail("An agent run is already in progress.");
  agentRunning = true;
  try {
    const { resolveShipment } = await loadModule("agent.mjs");
    const client = ai ? await claude.createClaude({ apiKey: ai.apiKey }) : undefined;
    const record = await resolveShipment({ root: __dirname, shipmentId: shipment, mode, client, emit: event => response.write("data: " + JSON.stringify(event) + "\n\n") });
    const { cacheDir } = await loadModule("sources.mjs");
    const dir = cacheDir(__dirname);
    await mkdir(dir, { recursive: true });
    await (await loadModule("approvals.mjs")).saveRun(__dirname, record);
    response.write("event: complete\ndata: " + JSON.stringify(record) + "\n\n");
    response.end();
  } catch (error) {
    const message = refusedMessage(error, ai) ? refusedMessage(error, ai) :
      error.code === "ERR_MODULE_NOT_FOUND" ? "The agent packages are not installed. Run npm install in the RegChain folder, then restart RegChain." :
      error.message || "The agent run failed.";
    console.error("Agent run failed: " + message);
    fail(message);
  } finally {
    agentRunning = false;
  }
}

// Every shipment that needs action, as one orchestrated run, streamed like a single run.
async function streamPortfolioRun(request, response) {
  const site = request.headers["sec-fetch-site"];
  if (site && !["same-origin", "none"].includes(site)) {
    sendJson(response, 403, { error: "Requests from other sites are refused." });
    return;
  }
  const mode = new URL(request.url, origin).searchParams.get("mode") === "live" ? "live" : "scripted";
  response.writeHead(200, { ...securityHeaders({ secure: config.secureCookies }), "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-RegChain-Local": identity });
  const fail = message => {
    response.write("event: failure\ndata: " + JSON.stringify({ error: message }) + "\n\n");
    response.end();
  };
  const ai = mode === "live" ? await aiFor(request) : null;
  if (ai && !ai.ready) return fail(ai.message);
  if (agentRunning) return fail("An agent run is already in progress.");
  try {
    const record = await runPortfolio(mode, event => response.write("data: " + JSON.stringify(event) + "\n\n"), ai);
    response.write("event: complete\ndata: " + JSON.stringify(record) + "\n\n");
    response.end();
  } catch (error) {
    fail(error.message);
  }
}
// The portfolio run itself: from the page (streamed) or after a scheduled check (in the background). `ai` is what
// aiFor() allowed for a live run: the .env key, or an administrator's connected key; null for a scripted run.
async function runPortfolio(mode, emit = () => {}, ai = null) {
  if (agentRunning) throw new Error("An agent run is already in progress.");
  agentRunning = true;
  try {
    const { resolvePortfolio } = await loadModule("agent.mjs");
    const client = ai ? await claude.createClaude({ apiKey: ai.apiKey }) : undefined;
    const { cacheDir } = await loadModule("sources.mjs");
    const dir = cacheDir(__dirname);
    await mkdir(dir, { recursive: true });
    const { record } = await resolvePortfolio({ root: __dirname, mode, client, emit,
      onShipment: async run => (await loadModule("approvals.mjs")).saveRun(__dirname, run) });
    await writeFile(join(dir, "agent-portfolio-run.json"), JSON.stringify(record, null, 2));
    return record;
  } catch (error) {
    const message = refusedMessage(error, ai) ? refusedMessage(error, ai) :
      error.code === "ERR_MODULE_NOT_FOUND" ? "The agent packages are not installed. Run npm install in the RegChain folder, then restart RegChain." :
      error.message || "The portfolio run failed.";
    console.error("Portfolio run failed: " + message);
    throw new Error(message);
  } finally {
    agentRunning = false;
  }
}

// ClinRadar's check (regchain-ai/check.mjs), from "Run the check" or from the scheduler. One at a time: a second one
// waits for the first to finish, then runs.
let checkRunning = null;
async function runCheck(options) {
  while (checkRunning) await checkRunning.catch(() => {});
  checkRunning = (async () => {
    const { runCheck: run } = await loadModule("check.mjs");
    return run({ root: __dirname, api: await api(), alerts: config.alerts, origin, ...options });
  })();
  try {
    return await checkRunning;
  } finally {
    checkRunning = null;
  }
}

// The server's own schedule (regchain-ai/scheduler.mjs): full checks on the monitoring schedule, feed polls between
// them, and the agents after a scheduled check when Settings say so. REGCHAIN_SCHEDULER=off stops it.
let scheduler = null;
async function startScheduler() {
  if (!config.scheduler) {
    console.log("Scheduled checks are off (REGCHAIN_SCHEDULER=off). Checks run only from the page.");
    return;
  }
  const { createScheduler, lastRuns } = await loadModule("scheduler.mjs");
  const { readSettings } = await loadModule("settings.mjs");
  const { openDatabase } = await loadModule("db.mjs");
  const { loadData } = await loadModule("rules.mjs");
  const policy = (await loadData(__dirname)).config ?? {};
  const minutes = [policy.monitoring?.weather_poll_minutes, policy.monitoring?.disaster_poll_minutes].filter(value => Number.isFinite(value) && value >= 5);
  scheduler = createScheduler({
    readMonitoring: () => readSettings(__dirname).monitoring,
    lastRuns: () => lastRuns(openDatabase(__dirname)),
    cadence: { pollMinutes: minutes.length ? Math.min(...minutes) : 30, regulatoryHours: Number.isFinite(policy.monitoring?.regulatory_poll_hours) && policy.monitoring.regulatory_poll_hours >= 1 ? policy.monitoring.regulatory_poll_hours : 24 },
    run: async job => {
      const result = await runCheck({ kind: job, reason: job === "check" ? "scheduled" : job, actor: "ClinRadar scheduler", role: null });
      logger.info("scheduled run", { job, counts: result.counts, alerts: result.alerts.raised });
      if (job === "check") await agentsAfterCheck().catch(error => console.error("The agents did not start after the scheduled check: " + error.message));
      return result;
    },
    logger,
  });
  scheduler.start();
  const status = scheduler.status();
  console.log(status.paused ? "Scheduled checks are paused (Settings › Monitoring schedule)." :
    "Scheduled checks: next full check " + status.nextCheckAt + ", feeds polled every " + status.pollMinutes + " minutes, regulatory sources every " + status.regulatoryHours + " hours.");
}
// "Have the agents prepare plans": after a scheduled check, the agents plan every blocked shipment that has no plan yet.
// Live with Claude when the server's own key (.env or cloud identity) is set up, otherwise the scripted walkthrough. A key
// an administrator connected in Settings serves signed-in administrators only, so a scheduled run never spends it.
// Plans are drafts; Clinical Supply approves.
async function agentsAfterCheck() {
  const { readSettings } = await loadModule("settings.mjs");
  if (readSettings(__dirname).monitoring.onBlocked !== "plan" || agentRunning) return;
  const { loadData, allShipmentChecks } = await loadModule("rules.mjs");
  const { planSummaries } = await loadModule("approvals.mjs");
  const plans = await planSummaries(__dirname);
  const blocked = allShipmentChecks(await loadData(__dirname)).filter(item => item.result === "Blocked" && !plans[item.id]);
  if (!blocked.length) return;
  const server = claude.claudeStatus();
  const ai = server.ready ? { ...server, apiKey: null, source: "env" } : null;
  const mode = ai ? "live" : "scripted";
  logger.info("agents after scheduled check", { mode, shipments: blocked.length });
  await runPortfolio(mode, () => {}, ai);
}
function schedulerStatus() {
  return scheduler ? scheduler.status() : { on: false, reason: config.scheduler ? "starting" : "off" };
}

// A small JSON body from the page. Requiring application/json means another site cannot post here without a preflight.
async function readJson(request) {
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) throw Object.assign(new Error("Send JSON."), { statusCode: 415 });
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 10000) throw Object.assign(new Error("Request too large."), { statusCode: 413 });
  }
  try { return JSON.parse(body || "{}"); } catch { throw Object.assign(new Error("Invalid JSON."), { statusCode: 400 }); }
}

// Whether this request may use Claude, and with which key. A key in the server's .env serves everyone who may start the
// run, as before. A key an administrator connected in Settings (regchain-ai/vault.mjs) serves signed-in administrators
// only, so nobody else can spend it; in local mode, without sign-in, it is never used.
async function aiFor(request) {
  const ai = claude.claudeStatus();
  if (ai.ready || ai.provider !== "anthropic") return { ...ai, apiKey: null, source: ai.ready ? "env" : null };
  const vault = await loadModule("vault.mjs");
  if (!vault.claudeKeyInfo(__dirname).set) return { ...ai, apiKey: null, source: null };
  const connected = claude.claudeStatus({ ...process.env, ANTHROPIC_API_KEY: "connected" });
  if (!connected.ready) return { ...connected, apiKey: null, source: null };
  const user = config.auth === "password" ? (await (await api()).actorFor(request)).session?.user : null;
  if (!user?.admin) return { ...ai, apiKey: null, source: "connected", message: "Claude is connected for administrators only. Sign in as an administrator to run the AI live." };
  const apiKey = vault.readClaudeKey(__dirname);
  if (!apiKey) return { ...ai, apiKey: null, source: "connected", message: "The connected Claude key cannot be read on this server. An administrator connects it again in Settings." };
  return { ...connected, apiKey, source: "connected" };
}
// Claude refused the key: say where to fix it, .env or Settings.
function refusedMessage(error, ai) {
  if (ai?.source === "connected" && (error?.status === 401 || error?.status === 403)) return "Anthropic did not accept the connected Claude key. An administrator connects a new one in Settings › AI agents & integrations.";
  return claude.credentialsRefused(error);
}

// What the page needs to know about the AI: which Claude service, whether it is set up for this person, and if not, the
// one thing to do. Who connected a key and when is shown to everyone; its last four characters to administrators only.
async function aiSetup(request) {
  const ai = await aiFor(request);
  const vault = await loadModule("vault.mjs");
  const info = vault.claudeKeyInfo(__dirname);
  const user = config.auth === "password" ? (await (await api()).actorFor(request)).session?.user : null;
  const admin = Boolean(user?.admin);
  return { service: ai.label, keySet: ai.configured, sdk: ai.installed, setup: ai.message, source: ai.source, envKey: claude.claudeStatus().configured,
    authMode: config.auth, admin, canConnect: admin && ai.provider === "anthropic",
    connection: info.set ? { set: true, by: info.by, at: info.at, checked: info.checked, ...(admin ? { last4: info.last4 } : {}) } : { set: false } };
}

async function latestAnalysis(caseId) {
  const { cacheDir } = await loadModule("sources.mjs");
  try {
    return JSON.parse(await readFile(join(cacheDir(__dirname), CASES[caseId].file), "utf8"));
  } catch {
    return null;
  }
}

async function runAnalysis(caseId, client) {
  const settings = CASES[caseId];
  const { diffLines, cacheDir } = await loadModule("sources.mjs");
  const { draftChange, verifyDraft } = await loadModule("analyze.mjs");
  const sources = await settings.sources();
  const rule = await settings.rule();
  const before = sources.find(source => source.role === "before");
  const after = sources.find(source => source.role === "after");
  const diff = settings.diff ? diffLines(before.text || "", after.text || "") : null;
  const { draft, model, usage } = await draftChange(sources, { profile: caseId, client });
  const verification = verifyDraft(draft, sources, rule);
  const result = {
    at: new Date().toISOString(),
    case: caseId,
    model,
    rule: { requirement: rule.requirement, effective: rule.effective },
    sources: sources.map(({ text, ...meta }) => ({ ...meta, characters: text.length })),
    diff: diff ? { added: diff.added, removed: diff.removed, lines: diff.lines } : null,
    draft,
    verification,
    usage
  };
  const dir = cacheDir(__dirname);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, settings.file), JSON.stringify(result, null, 2));
  return result;
}

// The public launch page (sites/clinradar/), served at /site/ before and after sign-in. Only files inside that folder
// with a known type; index.html gets a fresh script nonce like every other page.
const SITE_DIR = join(__dirname, "sites", "clinradar");
const SITE_TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};
async function serveSite(request, response, path) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { ...securityHeaders(), Allow: "GET, HEAD" }).end();
    return;
  }
  if (path === "/site") {
    const query = request.url.slice(path.length);
    response.writeHead(301, { ...securityHeaders(), Location: "/site/" + (query.startsWith("?") ? query : "") }).end();
    return;
  }
  const notFound = () => response.writeHead(404, { ...securityHeaders(), "Content-Type": "text/plain; charset=utf-8" }).end("Page not found");
  let name;
  try {
    name = decodeURIComponent(path.slice("/site/".length)) || "index.html";
  } catch {
    notFound();
    return;
  }
  // Plain relative names only: no "..", no backslashes, no hidden files, no NUL.
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/.test(name) || name.split("/").includes("..")) {
    notFound();
    return;
  }
  const file = resolve(SITE_DIR, name);
  const type = SITE_TYPES[extname(file).toLowerCase()];
  if (!file.startsWith(SITE_DIR + sep) || !type) {
    notFound();
    return;
  }
  let body;
  try {
    body = await readFile(file);
  } catch {
    notFound();
    return;
  }
  const html = type.startsWith("text/html");
  const nonce = html ? newNonce() : null;
  if (html) body = Buffer.from(withNonce(body.toString("utf8"), nonce));
  response.writeHead(200, {
    ...securityHeaders({ nonce, html, secure: config.secureCookies }),
    "Content-Type": type,
    "Content-Length": body.length,
    // The page carries a new nonce each time; its files may be cached briefly and are checked again after that.
    "Cache-Control": html ? "no-store" : "public, max-age=300, must-revalidate",
    "X-RegChain-Local": identity,
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

// The contact form on the launch page: public, same-site JSON only, size-limited, validated and rate-limited. Each
// request is one JSON line in <data dir>/contact-requests.jsonl. The client address is not stored. No email is sent.
const CONTACT_LIMITS = { name: 120, company: 160, email: 254, message: 3000 };
const CONTACT_EMAIL = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]{2,}$/;
function contactErrors(body) {
  const fields = {};
  const text = key => (typeof body[key] === "string" ? body[key].trim() : null);
  const labels = { name: "your name", company: "your company", email: "your work email", message: "a message" };
  for (const key of Object.keys(CONTACT_LIMITS)) {
    const value = text(key);
    if (!value) fields[key] = "Enter " + labels[key] + ".";
    else if (value.length > CONTACT_LIMITS[key]) fields[key] = "Use at most " + CONTACT_LIMITS[key] + " characters.";
  }
  if (!fields.email && !CONTACT_EMAIL.test(text("email"))) fields.email = "Enter a valid email address.";
  if (body.consent !== true) fields.consent = "Consent is needed so that we may reply.";
  return fields;
}
async function handleContact(request, response) {
  if (request.method !== "POST") {
    response.writeHead(405, { ...securityHeaders(), "Content-Type": "application/json; charset=utf-8", Allow: "POST" }).end(JSON.stringify({ error: "Send the contact form with POST." }));
    return;
  }
  const site = request.headers["sec-fetch-site"];
  if ((request.headers.origin && !allowedOrigins.includes(request.headers.origin)) || (site && !["same-origin", "none"].includes(site))) {
    request.resume();
    sendJson(response, 403, { error: "Requests from other sites are refused." });
    return;
  }
  const wait = contactLimit(clientAddress(request, config.trustProxy));
  if (wait) {
    request.resume();
    response.writeHead(429, { ...securityHeaders({ secure: config.secureCookies }), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Retry-After": String(wait) });
    response.end(JSON.stringify({ error: "Too many messages from this address. Try again later." }));
    return;
  }
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    request.resume();
    sendJson(response, 415, { error: "Send the contact form as JSON (Content-Type: application/json)." });
    return;
  }
  const maxBytes = 16 * 1024;
  if (Number(request.headers["content-length"] || 0) > maxBytes) {
    request.resume();
    sendJson(response, 413, { error: "The message is too large. Keep it under 3,000 characters." });
    return;
  }
  // Read with listeners rather than for-await: leaving a for-await loop early destroys the socket before the 413 is sent.
  const raw = await new Promise(done => {
    const chunks = [];
    let size = 0;
    request.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        request.removeAllListeners("data");
        request.resume();
        done(null);
      } else chunks.push(chunk);
    });
    request.on("end", () => done(Buffer.concat(chunks)));
    request.on("error", () => done(null));
  });
  if (raw === null) {
    response.setHeader("Connection", "close");
    sendJson(response, 413, { error: "The message is too large. Keep it under 3,000 characters." });
    return;
  }
  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    sendJson(response, 400, { error: "The request is not valid JSON." });
    return;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    sendJson(response, 400, { error: "Send the contact form as a JSON object." });
    return;
  }
  const fields = contactErrors(body);
  if (Object.keys(fields).length) {
    sendJson(response, 400, { error: "Check the highlighted fields.", fields });
    return;
  }
  const receivedAt = new Date().toISOString();
  const id = "CR-" + receivedAt.slice(0, 10).replace(/-/g, "") + "-" + randomBytes(3).toString("hex").toUpperCase();
  const entry = { id, receivedAt, name: body.name.trim(), company: body.company.trim(), email: body.email.trim(), message: body.message.trim(), consent: true };
  const { dataDir } = await loadModule("db.mjs");
  const dir = dataDir(__dirname);
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, "contact-requests.jsonl"), JSON.stringify(entry) + "\n", "utf8");
  logger.info("contact request stored", { id });
  sendJson(response, 201, { id, receivedAt });
}

// Enterprise risk alerts: the ingest webhook for the company's crisis-alerting system (regchain-ai/enterprise.mjs).
// JSON only, 256 KB at most, validated alert by alert, rate-limited per address. With named users (password mode) the
// caller sends "Authorization: Bearer <REGCHAIN_ENTERPRISE_TOKEN>", and the webhook is refused while that is unset; in
// local mode only this computer may call it. Each alert is stored in the data folder and audited.
const enterpriseLimit = createRateLimiter(config.writesPerMinute);
const LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
function sameSecret(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}
async function handleEnterpriseAlerts(request, response) {
  const refuse = (status, error, headers = {}) => {
    request.resume();
    response.writeHead(status, { ...securityHeaders({ secure: config.secureCookies }), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
    response.end(JSON.stringify({ error }));
  };
  if (request.method !== "POST") return refuse(405, "Send enterprise alerts with POST.", { Allow: "POST" });
  if (request.headers.origin && !allowedOrigins.includes(request.headers.origin)) return refuse(403, "Requests from other sites are refused.");
  if (config.auth === "password") {
    const token = String(process.env.REGCHAIN_ENTERPRISE_TOKEN ?? "").trim();
    if (!token) return refuse(503, "The enterprise alert webhook is off: set REGCHAIN_ENTERPRISE_TOKEN on the server to turn it on.");
    const given = /^Bearer\s+(.+)$/i.exec(String(request.headers.authorization ?? ""))?.[1]?.trim();
    if (!given || !sameSecret(given, token)) return refuse(401, "Send the enterprise system's bearer token.", { "WWW-Authenticate": "Bearer" });
  } else if (!LOOPBACK.includes(request.socket?.remoteAddress)) {
    return refuse(403, "In local mode, only this computer may send enterprise alerts.");
  }
  const wait = enterpriseLimit(clientAddress(request, config.trustProxy));
  if (wait) return refuse(429, "Too many requests. Try again in a minute.", { "Retry-After": String(wait) });
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) return refuse(415, "Send the alerts as JSON (Content-Type: application/json).");
  const maxBytes = 256 * 1024;
  if (Number(request.headers["content-length"] || 0) > maxBytes) return refuse(413, "The request is too large: send at most 256 KB per request.");
  const raw = await new Promise(done => {
    const chunks = [];
    let size = 0;
    request.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        request.removeAllListeners("data");
        request.resume();
        done(null);
      } else chunks.push(chunk);
    });
    request.on("end", () => done(Buffer.concat(chunks)));
    request.on("error", () => done(null));
  });
  if (raw === null) {
    response.setHeader("Connection", "close");
    sendJson(response, 413, { error: "The request is too large: send at most 256 KB per request." });
    return;
  }
  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    sendJson(response, 400, { error: "The request is not valid JSON." });
    return;
  }
  const { validateAlerts, storeEnterpriseAlerts } = await loadModule("enterprise.mjs");
  const { alerts, errors } = validateAlerts(body);
  if (errors) {
    sendJson(response, 422, { error: "Some alerts are not valid; none were stored.", details: errors.slice(0, 20) });
    return;
  }
  const { dataDir, appendAudit, openDatabase, transaction } = await loadModule("db.mjs");
  const stored = await storeEnterpriseAlerts(dataDir(__dirname), alerts);
  const db = openDatabase(__dirname);
  transaction(db, () => {
    for (const alert of alerts) appendAudit(db, { actor: alert.system, role: null, type: "enterprise.alert_received", subjectType: "enterprise_alert", subjectId: alert.id,
      detail: `${alert.severity ?? "Alert"} · ${alert.title}`, data: { country: alert.location.country, category: alert.category, window: alert.window, receivedAt: alert.receivedAt } });
  });
  // Say at once what ClinRadar made of each alert.
  const { loadData } = await loadModule("rules.mjs");
  const summary = (await loadData(__dirname)).supplyshield?.enterprise;
  const results = alerts.map(alert => ({ id: alert.id, result: summary?.alerts.find(item => item.id === alert.id)?.result ?? "stored" }));
  logger.info("enterprise alerts stored", { count: alerts.length });
  sendJson(response, 202, { received: alerts.length, stored, results });
}

// The /v1 API (regchain-ai/api.mjs): the database, the regulation pipeline and the case workflow on the server.
let apiPromise = null;
const api = () => (apiPromise ??= loadModule("api.mjs").then(module => module.createApi({ root: __dirname, config, allowedOrigins, logger, analyze: caseId => runAnalysis(caseId) })));

// ClinRadar's state for the page: the same payload the page carries for file mode, plus who is asking and what they
// may switch (Clinical Supply: external risk; the Regulatory SME: regulatory and customs).
async function supplyShieldState(request) {
  const { loadData, supplyShieldPayload } = await loadModule("rules.mjs");
  const { MONITORING_ROLES } = await loadModule("supplyshield.mjs");
  const payload = supplyShieldPayload(await loadData(__dirname));
  if (!payload) return { available: false };
  const { session } = await (await api()).actorFor(request);
  const { alertsSummary } = await loadModule("alerts.mjs");
  const { openDatabase } = await loadModule("db.mjs");
  return { available: true, ...payload, role: session?.role ?? null, roles: MONITORING_ROLES, authMode: config.auth,
    alerts: alertsSummary(openDatabase(__dirname), config.alerts), scheduler: schedulerStatus() };
}

async function handleApi(request, response, path) {
  const starts = request.method !== "GET" || path === "/api/agent/run" || path === "/api/agent/portfolio-run";
  if (starts) {
    const site = request.headers["sec-fetch-site"];
    if ((request.headers.origin && !allowedOrigins.includes(request.headers.origin)) || (site && !["same-origin", "none"].includes(site))) {
      sendJson(response, 403, { error: "Requests from other sites are refused." });
      return;
    }
    const wait = apiWriteLimit(clientAddress(request, config.trustProxy));
    if (wait) {
      response.writeHead(429, { ...securityHeaders({ secure: config.secureCookies }), "Content-Type": "application/json; charset=utf-8", "Retry-After": String(wait) });
      response.end(JSON.stringify({ error: "Too many requests. Try again in a minute." }));
      return;
    }
    if (config.auth === "password" && API_ROLES[path]) {
      const { session } = await (await api()).actorFor(request);
      // An administrator may start the AI runs whatever their role; approvals stay with the roles.
      const adminRun = session?.user?.admin && ["/api/agent/run", "/api/agent/portfolio-run", "/api/ai/analyze"].includes(path);
      if (session?.role !== API_ROLES[path][0] && !adminRun) {
        sendJson(response, 403, { error: API_ROLES[path][1] });
        return;
      }
    }
  }
  // An administrator connects the Claude API key (Anthropic) here, or removes it. The key is checked with Anthropic, kept
  // encrypted on the server (regchain-ai/vault.mjs) and never sent back: answers carry at most its last four characters.
  if ((path === "/api/ai/key" || path === "/api/ai/key/remove") && request.method === "POST") {
    const refuse = (statusCode, message) => Object.assign(new Error(message), { statusCode });
    try {
      if (config.auth !== "password") throw refuse(409, "Connecting Claude here needs named users: start ClinRadar with REGCHAIN_AUTH=password and sign in as an administrator, or put the key in the .env file.");
      const { session } = await (await api()).actorFor(request);
      if (!session?.user) throw refuse(401, "Sign in first.");
      if (!session.user.admin) throw refuse(403, "Only an administrator connects Claude.");
      const settings = claude.claudeSettings();
      if (settings.provider !== "anthropic") throw refuse(409, "This server reaches Claude through " + settings.label + ", set in the .env file. A key connected here is for the Claude API (Anthropic).");
      const vault = await loadModule("vault.mjs");
      const { appendAudit } = await loadModule("db.mjs");
      const { db } = await (await api()).context();
      const audit = (type, detail) => appendAudit(db, { actor: session.user.name, role: session.role, type, subjectType: "ai_service", subjectId: "anthropic", detail });
      if (path === "/api/ai/key/remove") {
        const result = vault.removeClaudeKey(__dirname);
        if (result.removed) audit("ai.key_removed", "Claude API key ending " + result.last4 + " removed");
      } else {
        const key = vault.checkKeyFormat((await readJson(request)).key);
        let checked = false;
        try {
          await (await claude.createClaude({ apiKey: key })).models.list({ limit: 1 });
          checked = true;
        } catch (error) {
          if (error?.status === 401 || error?.status === 403) throw refuse(422, "Anthropic did not accept this key. Check that it is active and copied in full.");
          // Anthropic could not be reached: keep the key and say it is not checked yet.
        }
        const info = vault.saveClaudeKey(__dirname, key, { by: session.user.name, checked });
        audit("ai.key_connected", "Claude API key ending " + info.last4 + (checked ? ", accepted by Anthropic" : ", not checked: Anthropic could not be reached"));
      }
      sendJson(response, 200, await aiSetup(request));
    } catch (error) {
      sendJson(response, error.statusCode ?? 500, { error: error.statusCode ? error.message : "The key could not be saved." });
    }
    return;
  }
  const caseId = caseFrom(request.url);
  if (!caseId) {
    sendJson(response, 400, { error: "Unknown case." });
    return;
  }
  if (path === "/api/ai/status" && request.method === "GET") {
    const recorded = await latestAnalysis(caseId);
    sendJson(response, 200, {
      model: claude.claudeSettings().models.aiCheck,
      ...(await aiSetup(request)),
      recorded: recorded ? { at: recorded.at, model: recorded.model, verified: recorded.verification.verified } : null
    });
    return;
  }
  if (path === "/api/agent/status" && request.method === "GET") {
    sendJson(response, 200, {
      ...(await aiSetup(request)),
      models: claude.liveModels(),
      systems: await agentSystems(),
      running: agentRunning,
    });
    return;
  }
  if (path === "/api/agent/last" && request.method === "GET") {
    const shipment = new URL(request.url, origin).searchParams.get("shipment") || "";
    if (!/^SHP-[A-Z0-9-]+$/.test(shipment)) {
      sendJson(response, 400, { error: "Unknown shipment." });
      return;
    }
    const { cacheDir } = await loadModule("sources.mjs");
    try {
      sendJson(response, 200, JSON.parse(await readFile(join(cacheDir(__dirname), "agent-run-" + shipment + ".json"), "utf8")));
    } catch {
      sendJson(response, 404, { error: "No agent run on this computer yet." });
    }
    return;
  }
  if (path === "/api/agent/run" && request.method === "GET") {
    await streamAgentRun(request, response);
    return;
  }
  if (path === "/api/agent/portfolio-run" && request.method === "GET") {
    await streamPortfolioRun(request, response);
    return;
  }
  if (path === "/api/agent/portfolio-last" && request.method === "GET") {
    const { cacheDir } = await loadModule("sources.mjs");
    try {
      sendJson(response, 200, JSON.parse(await readFile(join(cacheDir(__dirname), "agent-portfolio-run.json"), "utf8")));
    } catch {
      sendJson(response, 404, { error: "No portfolio run on this computer yet." });
    }
    return;
  }
  if (path === "/api/agent/plans" && request.method === "GET") {
    const { planSummaries } = await loadModule("approvals.mjs");
    sendJson(response, 200, await planSummaries(__dirname));
    return;
  }
  if (path === "/api/agent/approvals" && request.method === "GET") {
    const { readApprovals } = await loadModule("rules.mjs");
    const { approvalLog } = await loadModule("approvals.mjs");
    sendJson(response, 200, { approvals: await readApprovals(__dirname), log: await approvalLog(__dirname) });
    return;
  }
  if ((path === "/api/agent/approve" || path === "/api/agent/withdraw" || path === "/api/agent/start-fresh") && request.method === "POST") {
    if (request.headers.origin && !allowedOrigins.includes(request.headers.origin)) {
      sendJson(response, 403, { error: "Requests from other sites are refused." });
      return;
    }
    if (agentRunning) {
      sendJson(response, 409, { error: "An agent run is in progress. Approve when it has finished." });
      return;
    }
    try {
      const body = await readJson(request);
      const { approvePlan, withdrawPlan, startFresh } = await loadModule("approvals.mjs");
      const { session, label } = await (await api()).actorFor(request);
      if (path === "/api/agent/start-fresh") {
        if (config.auth !== "local") throw Object.assign(new Error("Starting fresh is only for rehearsals on one computer."), { statusCode: 403 });
        sendJson(response, 200, await startFresh(__dirname, { plans: Boolean(body.plans), empty: Boolean(body.empty), by: label ?? "Start fresh link" }));
        return;
      }
      if (!session?.role) throw Object.assign(new Error("Choose a role first."), { statusCode: 401 });
      if (path === "/api/agent/approve" && session.role !== "viewer") throw Object.assign(new Error("Clinical Supply approves supply plans."), { statusCode: 403 });
      sendJson(response, 200, path === "/api/agent/approve" ? await approvePlan(__dirname, { shipment: body.shipment, option: body.option, runAt: body.runAt, by: label, role: session.role })
        : await withdrawPlan(__dirname, { shipment: body.shipment, by: label, role: session.role }));
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || "The approval could not be recorded." });
    }
    return;
  }
  // ClinRadar: the monitoring scope from the active-trial portfolio, the recommended countries and their switches, and
  // every external signal matched to the shipments (regchain-ai/supplyshield.mjs, monitoring.mjs, feeds.mjs).
  if (path === "/api/supplyshield" && request.method === "GET") {
    try {
      sendJson(response, 200, await supplyShieldState(request));
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || "ClinRadar could not be read." });
    }
    return;
  }
  if ((path === "/api/supplyshield/monitoring" || path === "/api/supplyshield/recommendation" || path === "/api/supplyshield/portfolio" || path === "/api/supplyshield/check") && request.method === "POST") {
    if (agentRunning && path !== "/api/supplyshield/check") {
      sendJson(response, 409, { error: "An agent run is in progress. Change the monitoring scope when it has finished." });
      return;
    }
    try {
      const body = await readJson(request);
      const { session, label } = await (await api()).actorFor(request);
      if (!session?.role) throw Object.assign(new Error("Choose a role first."), { statusCode: 401 });
      const monitoring = await loadModule("monitoring.mjs");
      const { loadData } = await loadModule("rules.mjs");
      const data = await loadData(__dirname);
      if (!data.network) throw Object.assign(new Error("The supply network data is missing."), { statusCode: 500 });
      const who = { by: label, role: session.role };
      if (path === "/api/supplyshield/monitoring") {
        const allowed = data.supplyshield.scope.recommendations.map(item => item.code);
        monitoring.setMonitoring(__dirname, data.network, { country: body.country, kind: body.kind, enabled: body.enabled, reason: body.reason }, { ...who, allowed, names: data.supplyshield.names });
      } else if (path === "/api/supplyshield/recommendation") {
        const allowed = data.supplyshield.scope.recommendations.map(item => item.code);
        monitoring.reviewRecommendation(__dirname, data.network, { country: body.country, decision: body.decision, reason: body.reason }, { ...who, allowed, names: data.supplyshield.names });
      } else if (path === "/api/supplyshield/portfolio") {
        if (config.auth !== "local") throw Object.assign(new Error("The CTMS connection is part of the deployment, not a page setting."), { statusCode: 403 });
        monitoring.setPortfolioConnection(__dirname, data.network, Boolean(body.connected), who);
      } else {
        // The full check (regchain-ai/check.mjs): the official regulatory sources, the live feeds for the countries
        // monitored for external risk, the matching and the alerts to Clinical Supply. A source that does not answer keeps
        // its last good copy; the audit entry says how many answered and how many alerts went out.
        const result = await runCheck({ kind: "check", reason: "manual", actor: label ?? "ClinRadar", role: session.role });
        sendJson(response, 200, { ...(await supplyShieldState(request)), check: { at: result.at, counts: result.counts, failed: result.failed, regulatory: result.regulatory, alerts: result.alerts } });
        return;
      }
      sendJson(response, 200, await supplyShieldState(request));
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || "The change could not be recorded." });
    }
    return;
  }
  // The server's schedule: when the last check ran and when the next one will. The page asks every minute and reloads
  // ClinRadar's state when a check ran without it.
  if (path === "/api/scheduler" && request.method === "GET") {
    sendJson(response, 200, schedulerStatus());
    return;
  }
  // A test message to every alert channel that is set up, so the team sees where alerts arrive.
  if (path === "/api/alerts/test" && request.method === "POST") {
    try {
      await readJson(request);
      const { session, label } = await (await api()).actorFor(request);
      if (!session?.role) throw Object.assign(new Error("Choose a role first."), { statusCode: 401 });
      if (!["viewer", "owner"].includes(session.role)) throw Object.assign(new Error("Clinical Supply or the Quality owner sends a test alert."), { statusCode: 403 });
      const { sendTestAlert, alertsSummary } = await loadModule("alerts.mjs");
      const { openDatabase } = await loadModule("db.mjs");
      const db = openDatabase(__dirname);
      const results = await sendTestAlert(db, config.alerts, { origin, by: label, role: session.role });
      sendJson(response, 200, { results, alerts: alertsSummary(db, config.alerts) });
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || "The test alert could not be sent." });
    }
    return;
  }
  // Settings: the monitoring schedule and the connections the agents may use (regchain-ai/settings.mjs).
  if (path === "/api/settings" && request.method === "GET") {
    const { readSettings, SETTINGS_ROLES } = await loadModule("settings.mjs");
    const { session } = await (await api()).actorFor(request);
    sendJson(response, 200, { ...readSettings(__dirname), roles: SETTINGS_ROLES, role: session?.role ?? null });
    return;
  }
  if (path === "/api/settings" && request.method === "POST") {
    try {
      const body = await readJson(request);
      const settings = await loadModule("settings.mjs");
      const { session, label } = await (await api()).actorFor(request);
      if (!session?.role) throw Object.assign(new Error("Choose a role first."), { statusCode: 401 });
      const who = { by: label, role: session.role };
      let result;
      if (body.section === "monitoring") result = settings.saveMonitoring(__dirname, body.monitoring, who);
      else if (body.section === "connection-request") result = settings.requestConnection(__dirname, body.request, who);
      else if (body.section === "connection-decision") result = settings.decideConnection(__dirname, { id: body.id, decision: body.decision, note: body.note }, who);
      else throw Object.assign(new Error("Unknown setting."), { statusCode: 400 });
      sendJson(response, 200, { ...result, roles: settings.SETTINGS_ROLES, role: session.role });
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || "The setting could not be saved." });
    }
    return;
  }
  if (path === "/api/sources/retry" && request.method === "POST") {
    if (request.headers.origin && !allowedOrigins.includes(request.headers.origin)) {
      sendJson(response, 403, { error: "Requests from other sites are refused." });
      return;
    }
    request.resume();
    const source = RETRY_SOURCES[new URL(request.url, origin).searchParams.get("id")];
    if (!source) {
      sendJson(response, 404, { error: "This source cannot be checked again from here." });
      return;
    }
    try {
      const reply = await fetch(source.api, { headers: { "user-agent": "RegChain-prototype/0.1 (source check)", accept: "application/json" } });
      if (!reply.ok) throw new Error("The official site answered " + reply.status + ".");
      const page = await reply.json();
      const updated = page.public_updated_at || page.updated_at;
      if (!updated) throw new Error("The official page has no update date.");
      sendJson(response, 200, { title: page.title, updated, changed: updated.slice(0, 10) > source.edition, checkedAt: new Date().toISOString() });
    } catch (error) {
      sendJson(response, 502, { error: error.message || "The official site could not be reached." });
    }
    return;
  }
  if (path === "/api/ai/analysis" && request.method === "GET") {
    const recorded = await latestAnalysis(caseId);
    if (recorded) sendJson(response, 200, recorded);
    else sendJson(response, 404, { error: "No AI check has been run on this computer yet." });
    return;
  }
  if (path === "/api/ai/analyze" && request.method === "POST") {
    if (request.headers.origin && !allowedOrigins.includes(request.headers.origin)) {
      sendJson(response, 403, { error: "Requests from other sites are refused." });
      return;
    }
    request.resume();
    const ai = await aiFor(request);
    if (!ai.ready) {
      sendJson(response, 503, { error: ai.message });
      return;
    }
    if (analysisRunning) {
      sendJson(response, 409, { error: "An AI check is already running." });
      return;
    }
    analysisRunning = true;
    try {
      const result = await runAnalysis(caseId, ai.apiKey ? await claude.createClaude({ apiKey: ai.apiKey }) : undefined);
      const workflow = await (await api()).recordAnalysisResult(caseId, result).catch(error => { console.error("Recording the AI check failed: " + error.message); return null; });
      sendJson(response, 200, { ...result, workflow });
    } catch (error) {
      // The AI service refusing RegChain's credentials is a problem upstream (502), not a sign-in for this person (401).
      const status = error.status ? 502 : 500;
      const message = refusedMessage(error, ai) || error.message || "The AI check failed.";
      console.error("AI check failed: " + message);
      sendJson(response, status, { error: message });
    } finally {
      analysisRunning = false;
    }
    return;
  }
  sendJson(response, 404, { error: "Unknown API route." });
}

const server = createServer((request, response) => {
  const started = Date.now();
  const id = requestId(request);
  response.setHeader("X-Request-Id", id);
  const path = request.url.split("?")[0];
  response.on("finish", () => {
    if (path === "/v1/health") return;
    logger.info("request", { request_id: id, method: request.method, path, status: response.statusCode, ms: Date.now() - started, address: clientAddress(request, config.trustProxy) });
  });
  if (!config.hosts.includes(request.headers.host)) {
    response.writeHead(400, securityHeaders()).end("Use " + origin);
    return;
  }
  handleRequest(request, response, path).catch(error => {
    logger.error("request failed", { request_id: id, path, error: error.stack ?? error.message });
    if (!response.headersSent) sendJson(response, 500, { error: "Unexpected server error." });
  });
});

async function handleRequest(request, response, path) {
  if (path.startsWith("/v1/")) {
    await (await api()).handle(request, response, new URL(request.url, origin));
    return;
  }
  // The launch page and its contact form are public, also before sign-in in password mode.
  if (path === "/site" || path.startsWith("/site/")) {
    await serveSite(request, response, path);
    return;
  }
  if (path === "/api/contact") {
    await handleContact(request, response);
    return;
  }
  // The enterprise alert webhook is called by another system, with its own bearer token, not a signed-in person.
  if (path === "/api/enterprise-alerts") {
    await handleEnterpriseAlerts(request, response);
    return;
  }
  // In a shared deployment, the agents and the dashboard (with its data) need a signed-in user.
  const signedIn = config.auth === "local" || Boolean((await (await api()).authenticate(request))?.user);
  if (path.startsWith("/api/")) {
    if (!signedIn) {
      sendJson(response, 401, { error: "Sign in first." });
      return;
    }
    await handleApi(request, response, path);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { ...securityHeaders(), Allow: "GET, HEAD" }).end();
    return;
  }
  if (path !== "/" && path !== "/RegChain-AI-Dashboard.html" && path !== "/signin") {
    response.writeHead(404, securityHeaders()).end("Page not found");
    return;
  }
  const nonce = newNonce();
  const page = !signedIn || path === "/signin" ? (signedIn ? null : signInPage(nonce)) : Buffer.from(withNonce(dashboardPage().toString(), nonce));
  if (!page) {
    response.writeHead(302, { ...securityHeaders(), Location: "/" }).end();
    return;
  }
  response.writeHead(200, {
    ...securityHeaders({ nonce, html: true, secure: config.secureCookies }),
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": page.length,
    "Cache-Control": "no-store",
    "X-RegChain-Local": identity
  });
  response.end(request.method === "HEAD" ? undefined : page);
}

function reportStartError(error) {
  console.error("Could not start RegChain at " + origin + " (" + error.code + ").");
  process.exitCode = 1;
}

server.on("error", error => {
  if (error.code !== "EADDRINUSE") {
    reportStartError(error);
    return;
  }
  const probe = get(origin + "/", { method: "HEAD", timeout: 2000 }, response => {
    response.resume();
    if (response.statusCode === 200 && response.headers["x-regchain-local"] === identity) {
      console.log("RegChain is already running at " + origin);
      openBrowser();
    } else {
      reportStartError(error);
    }
  });
  probe.on("timeout", () => probe.destroy());
  probe.on("error", () => reportStartError(error));
});

server.listen(port, host, () => {
  const ai = claude.claudeStatus();
  console.log("Claude service: " + ai.label + (ai.ready ? ", ready for live AI checks and agent runs." : ". Live AI is off: " + ai.message));
  console.log("RegChain AI is running at " + origin + (config.auth === "password" ? " (named users sign in)" : "") + "\nPress Ctrl+C to stop.");
  openBrowser();
  agentSystems().catch(error => console.error("The agent systems did not start: " + error.message));
  api().then(instance => instance.context()).then(() => startScheduler())
    .catch(error => console.error("The database or the scheduler did not start: " + error.message));
  const { channelStatus } = require("./regchain-ai/notify.mjs");
  const channels = channelStatus(config.alerts);
  console.log("Alerts to Clinical Supply: " + (channels.any ? [channels.email.ready ? "email to " + channels.email.recipients.join(", ") : "", channels.webhook.ready ? channels.webhook.format + " webhook (" + channels.webhook.host + ")" : ""].filter(Boolean).join(" and ") :
    "shown in ClinRadar only. Set REGCHAIN_ALERT_EMAIL_TO and REGCHAIN_SMTP_*, or REGCHAIN_ALERT_WEBHOOK_URL, to send them.") +
    [...channels.email.problems, ...channels.webhook.problems].map(problem => "\n  " + problem).join(""));
});
