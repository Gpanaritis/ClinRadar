"use strict";

const { createServer, get } = require("node:http");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { spawn } = require("node:child_process");

const host = "127.0.0.1";
const port = 4173;
const origin = "http://" + host + ":" + port;
const identity = "regchain-dashboard";
const dashboard = readFileSync(join(__dirname, "RegChain-AI-Dashboard.html"));
const wantBrowser = process.argv.includes("--open");

function openBrowser() {
  if (!wantBrowser || process.platform !== "win32") return;
  const browser = spawn("cmd.exe", ["/d", "/c", "start", "", origin + "/"], {
    stdio: "ignore",
    windowsHide: true
  });
  browser.on("error", () => console.error("Open " + origin + " in your browser."));
  browser.unref();
}

const server = createServer((request, response) => {
  const validHost = [host + ":" + port, "localhost:" + port].includes(request.headers.host);
  if (!validHost) {
    response.writeHead(400).end("Use " + origin);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const path = request.url.split("?")[0];
  if (path !== "/" && path !== "/RegChain-AI-Dashboard.html") {
    response.writeHead(404).end("Page not found");
    return;
  }
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
