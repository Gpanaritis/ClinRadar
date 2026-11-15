"use strict";

const { createServer, get } = require("node:http");
const { readFileSync, existsSync } = require("node:fs");
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");

const host = "127.0.0.1";
const port = Number(process.env.REGCHAIN_PORT) || 4173;
const origin = "http://" + host + ":" + port;
const allowedOrigins = [origin, "http://localhost:" + port];
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
const wantBrowser = process.argv.includes("--open");

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

// An Anthropic API key can live in a local .env file, which git ignores.
const envFile = join(__dirname, ".env");
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    console.error("Could not read .env (" + error.message + ").");
  }
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
  response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-RegChain-Local": identity });
  const fail = message => {
    response.write("event: failure\ndata: " + JSON.stringify({ error: message }) + "\n\n");
    response.end();
  };
  const { loadData, shipmentView } = await loadModule("rules.mjs");
  if (!shipmentView(await loadData(__dirname), shipment)) return fail("Unknown shipment.");
  if (mode === "live" && !(await sdkInstalled())) return fail("The Anthropic SDK is not installed. Run npm install in the RegChain folder, then restart.");
  if (mode === "live" && !(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) return fail("Add ANTHROPIC_API_KEY to the .env file next to serve-regchain.cjs, then restart RegChain.");
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
    const message = error.status === 401 ? "The Anthropic API key was not accepted. Check ANTHROPIC_API_KEY in the .env file." :
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
  response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-RegChain-Local": identity });
  const fail = message => {
    response.write("event: failure\ndata: " + JSON.stringify({ error: message }) + "\n\n");
    response.end();
  };
  if (mode === "live" && !(await sdkInstalled())) return fail("The Anthropic SDK is not installed. Run npm install in the RegChain folder, then restart.");
  if (mode === "live" && !(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) return fail("Add ANTHROPIC_API_KEY to the .env file next to serve-regchain.cjs, then restart RegChain.");
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
    const message = error.status === 401 ? "The Anthropic API key was not accepted. Check ANTHROPIC_API_KEY in the .env file." :
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

async function sdkInstalled() {
  try {
    await import("@anthropic-ai/sdk");
    return true;
  } catch {
    return false;
  }
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

async function handleApi(request, response, path) {
  const caseId = caseFrom(request.url);
  if (!caseId) {
    sendJson(response, 400, { error: "Unknown case." });
    return;
  }
  if (path === "/api/ai/status" && request.method === "GET") {
    const recorded = await latestAnalysis(caseId);
    sendJson(response, 200, {
      model: (await loadModule("analyze.mjs")).MODEL,
      keySet: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
      sdk: await sdkInstalled(),
      recorded: recorded ? { at: recorded.at, model: recorded.model, verified: recorded.verification.verified } : null
    });
    return;
  }
  if (path === "/api/agent/status" && request.method === "GET") {
    const agent = await loadModule("agent.mjs");
    sendJson(response, 200, {
      keySet: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
      sdk: await sdkInstalled(),
      models: { orchestrator: agent.ORCHESTRATOR_MODEL, specialists: agent.SPECIALIST_MODEL },
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
      sendJson(response, 200, path === "/api/agent/approve" ? await approvePlan(__dirname, body) : path === "/api/agent/withdraw" ? await withdrawPlan(__dirname, body) : await startFresh(__dirname, body));
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || "The approval could not be recorded." });
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
    if (!(await sdkInstalled())) {
      sendJson(response, 503, { error: "The Anthropic SDK is not installed. Run npm install in the RegChain folder, then restart." });
      return;
    }
    if (analysisRunning) {
      sendJson(response, 409, { error: "An AI check is already running." });
      return;
    }
    analysisRunning = true;
    try {
      sendJson(response, 200, await runAnalysis(caseId));
    } catch (error) {
      const status = error.status === 401 ? 401 : error.status ? 502 : 500;
      const message = error.status === 401
        ? "The Anthropic API key was not accepted. Check ANTHROPIC_API_KEY in the .env file."
        : error.message || "The AI check failed.";
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
  const validHost = [host + ":" + port, "localhost:" + port].includes(request.headers.host);
  if (!validHost) {
    response.writeHead(400).end("Use " + origin);
    return;
  }
  const path = request.url.split("?")[0];
  if (path.startsWith("/api/")) {
    handleApi(request, response, path).catch(error => {
      console.error(error);
      if (!response.headersSent) sendJson(response, 500, { error: "Unexpected server error." });
    });
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  if (path !== "/" && path !== "/RegChain-AI-Dashboard.html") {
    response.writeHead(404).end("Page not found");
    return;
  }
  const dashboard = dashboardPage();
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": dashboard.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-RegChain-Local": identity
  });
  response.end(request.method === "HEAD" ? undefined : dashboard);
});

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
  console.log("RegChain AI is running at " + origin + "\nPress Ctrl+C to stop.");
  openBrowser();
  agentSystems().catch(error => console.error("The agent systems did not start: " + error.message));
});
