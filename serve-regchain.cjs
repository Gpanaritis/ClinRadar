"use strict";

const { createServer, get } = require("node:http");
const { readFileSync, existsSync } = require("node:fs");
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const { join } = require("node:path");
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
const wantBrowser = process.argv.includes("--open") && config.auth === "local";

// The sign-in page of a shared deployment. The dashboard and its data are served only after sign-in.
function signInPage(nonce) {
  return Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RegChain AI | Sign in</title>
<style>:root{font:15px/1.5 Inter,"Segoe UI",sans-serif;color:#132446;background:#f5f8fc}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px}main{width:100%;max-width:380px;background:#fff;border:1px solid #e0e8f3;border-radius:12px;padding:28px;box-shadow:0 2px 5px #14356212}
h1{font-size:22px;margin:0 0 4px}p{color:#536683;margin:0 0 18px;font-size:14px}label{display:grid;gap:4px;font-size:12px;font-weight:700;color:#445b7c;margin-bottom:12px}input{font:inherit;padding:9px 10px;border:1px solid #d5e2f1;border-radius:8px}
button{width:100%;font:inherit;font-weight:700;color:#fff;background:#1a52d1;border:0;border-radius:8px;padding:10px;cursor:pointer}button:disabled{opacity:.6}#error{color:#9f2c42;font-size:13px;min-height:20px;margin:10px 0 0}</style></head>
<body><main><h1>RegChain AI</h1><p>Sign in with your RegChain account.</p><form id="signin"><label>Username<input name="username" autocomplete="username" required maxlength="80"></label>
<label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="200"></label><button type="submit">Sign in</button><p id="error" role="alert"></p></form></main>
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
  const browser = spawn("cmd.exe", ["/d", "/c", "start", "", origin + "/"], {
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
  if (mode === "live") {
    const ai = claude.claudeStatus();
    if (!ai.ready) return fail(ai.message);
  }
  if (agentRunning) return fail("An agent run is already in progress.");
  agentRunning = true;
  try {
    const { resolveShipment } = await loadModule("agent.mjs");
    const record = await resolveShipment({ root: __dirname, shipmentId: shipment, mode, emit: event => response.write("data: " + JSON.stringify(event) + "\n\n") });
    const { cacheDir } = await loadModule("sources.mjs");
    const dir = cacheDir(__dirname);
    await mkdir(dir, { recursive: true });
    await (await loadModule("approvals.mjs")).saveRun(__dirname, record);
    response.write("event: complete\ndata: " + JSON.stringify(record) + "\n\n");
    response.end();
  } catch (error) {
    const message = claude.credentialsRefused(error) ? claude.credentialsRefused(error) :
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
  if (mode === "live") {
    const ai = claude.claudeStatus();
    if (!ai.ready) return fail(ai.message);
  }
  if (agentRunning) return fail("An agent run is already in progress.");
  agentRunning = true;
  try {
    const { resolvePortfolio } = await loadModule("agent.mjs");
    const { cacheDir } = await loadModule("sources.mjs");
    const dir = cacheDir(__dirname);
    await mkdir(dir, { recursive: true });
    const { record } = await resolvePortfolio({ root: __dirname, mode,
      emit: event => response.write("data: " + JSON.stringify(event) + "\n\n"),
      onShipment: async run => (await loadModule("approvals.mjs")).saveRun(__dirname, run) });
    await writeFile(join(dir, "agent-portfolio-run.json"), JSON.stringify(record, null, 2));
    response.write("event: complete\ndata: " + JSON.stringify(record) + "\n\n");
    response.end();
  } catch (error) {
    const message = claude.credentialsRefused(error) ? claude.credentialsRefused(error) :
      error.code === "ERR_MODULE_NOT_FOUND" ? "The agent packages are not installed. Run npm install in the RegChain folder, then restart RegChain." :
      error.message || "The portfolio run failed.";
    console.error("Portfolio run failed: " + message);
    fail(message);
  } finally {
    agentRunning = false;
  }
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

// What the page needs to know about the AI: which Claude service, whether it is set up, and if not, the one thing to do.
function aiSetup() {
  const ai = claude.claudeStatus();
  return { service: ai.label, keySet: ai.configured, sdk: ai.installed, setup: ai.message };
}

async function latestAnalysis(caseId) {
  const { cacheDir } = await loadModule("sources.mjs");
  try {
    return JSON.parse(await readFile(join(cacheDir(__dirname), CASES[caseId].file), "utf8"));
  } catch {
    return null;
  }
}

async function runAnalysis(caseId) {
  const settings = CASES[caseId];
  const { diffLines, cacheDir } = await loadModule("sources.mjs");
  const { draftChange, verifyDraft } = await loadModule("analyze.mjs");
  const sources = await settings.sources();
  const rule = await settings.rule();
  const before = sources.find(source => source.role === "before");
  const after = sources.find(source => source.role === "after");
  const diff = settings.diff ? diffLines(before.text || "", after.text || "") : null;
  const { draft, model, usage } = await draftChange(sources, { profile: caseId });
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

// The /v1 API (regchain-ai/api.mjs): the database, the regulation pipeline and the case workflow on the server.
let apiPromise = null;
const api = () => (apiPromise ??= loadModule("api.mjs").then(module => module.createApi({ root: __dirname, config, allowedOrigins, logger, analyze: caseId => runAnalysis(caseId) })));

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
      if (session?.role !== API_ROLES[path][0]) {
        sendJson(response, 403, { error: API_ROLES[path][1] });
        return;
      }
    }
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
      ...aiSetup(),
      recorded: recorded ? { at: recorded.at, model: recorded.model, verified: recorded.verification.verified } : null
    });
    return;
  }
  if (path === "/api/agent/status" && request.method === "GET") {
    sendJson(response, 200, {
      ...aiSetup(),
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
        sendJson(response, 200, await startFresh(__dirname, { plans: Boolean(body.plans), by: label ?? "Start fresh link" }));
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
    const ai = claude.claudeStatus();
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
      const result = await runAnalysis(caseId);
      const workflow = await (await api()).recordAnalysisResult(caseId, result).catch(error => { console.error("Recording the AI check failed: " + error.message); return null; });
      sendJson(response, 200, { ...result, workflow });
    } catch (error) {
      // The AI service refusing RegChain's credentials is a problem upstream (502), not a sign-in for this person (401).
      const status = error.status ? 502 : 500;
      const message = claude.credentialsRefused(error) || error.message || "The AI check failed.";
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
  api().then(instance => instance.context()).catch(error => console.error("The database did not start: " + error.message));
});
