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
const portfolioFile = join(__dirname, "demo-data", "uk-labelling-portfolio.json");

// The page gets the fictional demo portfolio as JSON inside a data script tag.
// The file is read on every request, so a rebuilt portfolio shows on reload.
function dashboardPage() {
  let page = dashboardHtml;
  try {
    const data = readFileSync(portfolioFile, "utf8");
    JSON.parse(data);
    const tag = '<script id="portfolio-data" type="application/json">' + data.replace(/</g, "\\u003c") + "</script>\n";
    page = page.replace('<script id="dashboard-data">', tag + '<script id="dashboard-data">');
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Demo portfolio not loaded: " + error.message);
  }
  return Buffer.from(page);
}
const wantBrowser = process.argv.includes("--open");

// The recorded company rule the AI draft is checked against (mirrors ukCase in the dashboard).
const RULE = { requirement: "GB/IMP_LABELING", effective: "2026-04-28" };

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

async function sdkInstalled() {
  try {
    await import("@anthropic-ai/sdk");
    return true;
  } catch {
    return false;
  }
}

async function latestAnalysis() {
  const { cacheDir } = await loadModule("sources.mjs");
  try {
    return JSON.parse(await readFile(join(cacheDir(__dirname), "analysis-latest.json"), "utf8"));
  } catch {
    return null;
  }
}

async function runAnalysis() {
  const { loadSources, diffLines, cacheDir } = await loadModule("sources.mjs");
  const { draftChange, verifyDraft } = await loadModule("analyze.mjs");
  const sources = await loadSources(__dirname, { refresh: true });
  const before = sources.find(source => source.role === "before");
  const after = sources.find(source => source.role === "after");
  const diff = diffLines(before.text || "", after.text || "");
  const { draft, model, usage } = await draftChange(sources);
  const verification = verifyDraft(draft, sources, RULE);
  const result = {
    at: new Date().toISOString(),
    model,
    rule: RULE,
    sources: sources.map(({ text, ...meta }) => ({ ...meta, characters: text.length })),
    diff: { added: diff.added, removed: diff.removed, lines: diff.lines },
    draft,
    verification,
    usage
  };
  const dir = cacheDir(__dirname);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "analysis-latest.json"), JSON.stringify(result, null, 2));
  return result;
}

async function handleApi(request, response, path) {
  if (path === "/api/ai/status" && request.method === "GET") {
    const recorded = await latestAnalysis();
    sendJson(response, 200, {
      model: (await loadModule("analyze.mjs")).MODEL,
      keySet: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
      sdk: await sdkInstalled(),
      recorded: recorded ? { at: recorded.at, model: recorded.model, verified: recorded.verification.verified } : null
    });
    return;
  }
  if (path === "/api/ai/analysis" && request.method === "GET") {
    const recorded = await latestAnalysis();
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
      sendJson(response, 200, await runAnalysis());
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
});
