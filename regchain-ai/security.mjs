// Security headers, request IDs, structured logs and rate limits for every response the server sends.

import { randomBytes, randomUUID } from "node:crypto";

// A fresh nonce per page: only the page's own inline scripts run, nothing injected.
export const newNonce = () => randomBytes(16).toString("base64");

export function securityHeaders({ nonce = null, secure = false, html = false } = {}) {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  };
  headers["Content-Security-Policy"] = html
    ? `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`
    : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
  if (secure) headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

// Give every inline script of a page the nonce, so the policy lets exactly those run.
export function withNonce(html, nonce) {
  return html.replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`);
}

export function requestId(request) {
  const given = String(request.headers["x-request-id"] ?? "");
  return /^[A-Za-z0-9._-]{8,80}$/.test(given) ? given : randomUUID();
}
export function clientAddress(request, trustProxy) {
  if (trustProxy && request.headers["x-forwarded-for"]) return String(request.headers["x-forwarded-for"]).split(",")[0].trim();
  return request.socket?.remoteAddress ?? "unknown";
}

// One line per event. JSON by default, so a log platform can index it; text for reading in a terminal.
export function createLogger({ format = "json", level = "info" } = {}) {
  const levels = { debug: 10, info: 20, warn: 30, error: 40 };
  const min = levels[level] ?? 20;
  const write = (lvl, message, fields = {}) => {
    if ((levels[lvl] ?? 20) < min) return;
    const entry = { time: new Date().toISOString(), level: lvl, message, ...fields };
    const line = format === "text" ? `${entry.time} ${lvl.toUpperCase()} ${message} ${Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(" ")}` : JSON.stringify(entry);
    (lvl === "error" || lvl === "warn" ? process.stderr : process.stdout).write(line + "\n");
  };
  return { debug: (m, f) => write("debug", m, f), info: (m, f) => write("info", m, f), warn: (m, f) => write("warn", m, f), error: (m, f) => write("error", m, f) };
}

// A sliding one-minute window per key. Returns the seconds to wait when over the limit.
export function createRateLimiter(limit, windowMs = 60000) {
  const hits = new Map();
  return key => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter(time => now - time < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return Math.ceil((windowMs - (now - recent[0])) / 1000);
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 10000) for (const [entry, times] of hits) if (!times.some(time => now - time < windowMs)) hits.delete(entry);
    return 0;
  };
}
