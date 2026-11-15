// Checks what a shared deployment relies on, without network or AI calls:
//   1. settings, password hashing, user rules, sign-in lockout and session expiry, security headers, rate limits;
//   2. the real server started with named users (REGCHAIN_AUTH=password) on a free port: sign-in gating, roles,
//      same-site and input checks, the page's script nonce, sign-out, lockout, a backup taken while it runs, and the
//      write rate limit.
// Usage: node scripts/check-security.mjs   (everything runs in temporary folders)

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "regchain-security-check-"));
const dataDir = join(temp, "data");
const cacheDir = join(temp, "cache");
await mkdir(cacheDir, { recursive: true });
process.env.REGCHAIN_DATA_DIR = dataDir;
process.env.REGCHAIN_CACHE_DIR = cacheDir;

const { closeDatabase, openDatabase, verifyAudit } = await import("../regchain-ai/db.mjs");
const { createUser, hashPassword, setActive, setPassword, signIn, sessionFor, verifyPassword } = await import("../regchain-ai/auth.mjs");
const { loadConfig } = await import("../regchain-ai/config.mjs");
const { createRateLimiter, securityHeaders, withNonce } = await import("../regchain-ai/security.mjs");

const statusOf = fn => { try { fn(); return 200; } catch (error) { return error.statusCode ?? error.message; } };

// ---------- 1. Settings ----------
{
  assert.throws(() => loadConfig({ REGCHAIN_HOST: "0.0.0.0" }), /REGCHAIN_AUTH=password/, "role switching never listens on the network by accident");
  const shared = loadConfig({ REGCHAIN_HOST: "0.0.0.0", REGCHAIN_AUTH: "password", REGCHAIN_PUBLIC_ORIGIN: "https://regchain.example.org/" });
  assert.equal(shared.publicOrigin, "https://regchain.example.org");
  assert.equal(shared.secureCookies, true);
  assert.ok(shared.hosts.includes("regchain.example.org"));
  const local = loadConfig({});
  assert.deepEqual([local.auth, local.host, local.port, local.secureCookies], ["local", "127.0.0.1", 4173, false]);
  console.log("ok  settings: role switching only on this computer, a public HTTPS address turns on secure cookies, safe defaults");
}

// ---------- 2. Passwords, users, sign-in, sessions ----------
const unitPath = join(temp, "unit.db");
const db = openDatabase(root, { path: unitPath });
const config = loadConfig({ REGCHAIN_AUTH: "password", REGCHAIN_LOGIN_ATTEMPTS: "3", REGCHAIN_LOGIN_ATTEMPTS_PER_ADDRESS: "6" });
{
  const hash = hashPassword("correct horse battery");
  assert.ok(!hash.includes("correct"), "the password is never stored");
  assert.notEqual(hash, hashPassword("correct horse battery"), "each hash has its own salt");
  assert.equal(verifyPassword("correct horse battery", hash), true);
  assert.equal(verifyPassword("correct horse batterz", hash), false);
  assert.equal(statusOf(() => createUser(db, { username: "ana", name: "Ana", role: "viewer", password: "short" })), 422);
  assert.equal(statusOf(() => createUser(db, { username: "ana", name: "Ana", role: "admin", password: "long enough password" })), 422);
  assert.equal(statusOf(() => createUser(db, { username: "a b", name: "Ana", role: "viewer", password: "long enough password" })), 422);
  createUser(db, { username: "ana", name: "Ana Supply", role: "viewer", password: "ana-password-123" });
  createUser(db, { username: "ben", name: "Ben Quality", role: "owner", password: "ben-password-123" });
  assert.equal(statusOf(() => createUser(db, { username: "ana", name: "Ana Two", role: "viewer", password: "long enough password" })), 409);
  console.log("ok  passwords and users: salted scrypt hashes, 12-character minimum, one known role each, unique usernames");
}
{
  const at = "10.0.0.1";
  assert.equal(statusOf(() => signIn(db, config, { username: "ana", password: "wrong-password-1", address: at })), 401);
  assert.equal(statusOf(() => signIn(db, config, { username: "nobody", password: "wrong-password-1", address: at })), 401, "an unknown username answers the same way");
  assert.equal(statusOf(() => signIn(db, config, { username: "ana", password: "wrong-password-2", address: at })), 401);
  assert.equal(statusOf(() => signIn(db, config, { username: "ana", password: "wrong-password-3", address: at })), 401);
  assert.equal(statusOf(() => signIn(db, config, { username: "ana", password: "ana-password-123", address: at })), 429, "the account is locked after 3 failures, even with the right password");
  assert.equal(statusOf(() => signIn(db, config, { username: "ben", password: "ben-password-123", address: at })), 200, "a colleague at the same address can still sign in");
  // Someone tries one password on many usernames from one address: the address is locked, other addresses are not.
  for (let index = 0; index < 6; index += 1) statusOf(() => signIn(db, config, { username: "guess" + index, password: "Spring2026!!", address: "10.0.0.9" }));
  assert.equal(statusOf(() => signIn(db, config, { username: "ben", password: "ben-password-123", address: "10.0.0.9" })), 429);
  assert.equal(statusOf(() => signIn(db, config, { username: "ben", password: "ben-password-123", address: "10.0.0.2" })), 200);
  const types = new Set(db.prepare("SELECT type FROM audit_entry").all().map(row => row.type));
  for (const type of ["auth.sign_in_failed", "auth.sign_in_locked", "auth.signed_in", "user.created"]) assert.ok(types.has(type), type + " is in the audit trail");
  console.log("ok  sign-in: wrong passwords lock the account, password spraying locks the address, and every attempt is audited");
}
{
  const fresh = () => signIn(db, config, { username: "ben", password: "ben-password-123", address: "10.0.0.3" }).sessionId;
  const id = fresh();
  assert.equal(sessionFor(db, config, id).user.name, "Ben Quality");
  assert.equal(sessionFor(db, config, id).role, "owner");
  assert.equal(sessionFor(db, config, "not-a-session"), null);
  db.prepare("UPDATE session SET last_seen = ? WHERE id = ?").run(new Date(Date.now() - (config.sessionIdleMinutes + 1) * 60000).toISOString(), id);
  assert.equal(sessionFor(db, config, id), null, "an idle session ends");
  assert.equal(db.prepare("SELECT 1 FROM session WHERE id = ?").get(id), undefined, "and is removed");
  const old = fresh();
  db.prepare("UPDATE session SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), old);
  assert.equal(sessionFor(db, config, old), null, "a session ends after its maximum length, however active");
  const beforeDisable = fresh();
  setActive(db, "ben", false);
  assert.equal(sessionFor(db, config, beforeDisable), null, "disabling a user ends their sessions");
  assert.equal(statusOf(() => signIn(db, config, { username: "ben", password: "ben-password-123", address: "10.0.0.4" })), 401);
  setActive(db, "ben", true);
  const beforeReset = fresh();
  setPassword(db, "ben", "ben-new-password-456");
  assert.equal(sessionFor(db, config, beforeReset), null, "a password change ends their sessions");
  assert.equal(statusOf(() => signIn(db, config, { username: "ben", password: "ben-password-123", address: "10.0.0.5" })), 401);
  assert.equal(statusOf(() => signIn(db, config, { username: "ben", password: "ben-new-password-456", address: "10.0.0.5" })), 200);
  assert.equal(verifyAudit(db).ok, true);
  closeDatabase(root, { path: unitPath });
  console.log("ok  sessions: idle and maximum-length expiry, disabling a user or changing a password signs them out");
}

// ---------- 3. Headers and limits ----------
{
  const page = securityHeaders({ html: true, nonce: "abc123", secure: true });
  const scriptSrc = page["Content-Security-Policy"].match(/script-src ([^;]+)/)[1];
  assert.equal(scriptSrc, "'nonce-abc123'", "only scripts carrying the page's nonce run");
  assert.match(page["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(page["Strict-Transport-Security"], /max-age=31536000/);
  const api = securityHeaders();
  assert.match(api["Content-Security-Policy"], /^default-src 'none'/);
  assert.equal(api["X-Frame-Options"], "DENY");
  assert.equal(api["X-Content-Type-Options"], "nosniff");
  assert.equal(api["Strict-Transport-Security"], undefined, "HSTS only over HTTPS");
  const html = await readFile(join(root, "RegChain-AI-Dashboard.html"), "utf8");
  const stamped = withNonce(html, "n0nce");
  assert.equal((stamped.match(/<script\b/g) ?? []).length, (stamped.match(/<script nonce="n0nce"/g) ?? []).length, "every script of the page gets the nonce");
  const limit = createRateLimiter(3);
  assert.deepEqual([limit("a"), limit("a"), limit("a")], [0, 0, 0]);
  assert.ok(limit("a") > 0, "the fourth request in a minute waits");
  assert.equal(limit("b"), 0, "limits are per client");
  console.log("ok  headers and limits: nonce-only scripts, no framing, no sniffing, HSTS over HTTPS, per-client write limits");
}

// ---------- 4. The server with named users ----------
const cache = (id, text) => writeFile(join(cacheDir, `source-${id}.json`), JSON.stringify({ id, role: id.includes("before") ? "before" : id.includes("after") ? "after" : "supporting", title: id,
  authority: "UK Legislation", kind: id.startsWith("mhra") ? "govuk" : "legislation", url: "https://example.org/" + id, text, validFrom: "2026-04-28", hash: "x", retrievedAt: "2026-11-14T08:00:00Z" }));
await cache("reg46-before", "46. Labelling of investigational medicinal products under Article 15.");
await cache("reg46-after", "46. Labelling of investigational medicinal products under Part 7 as amended.");
await cache("sch14-para6", "6. An IMP may be labelled in accordance with regulation 46 of the old rules where the conditions are met.");
await cache("mhra-labelling-transition", "The manufacturing date is the date of QP batch certification of the finished IMP.");

const port = await new Promise(resolve => {
  const probe = createServer().listen(0, "127.0.0.1", () => { const { port: free } = probe.address(); probe.close(() => resolve(free)); });
});
const env = { ...process.env, REGCHAIN_AUTH: "password", REGCHAIN_HOST: "127.0.0.1", REGCHAIN_PORT: String(port), REGCHAIN_DATA_DIR: dataDir, REGCHAIN_CACHE_DIR: cacheDir,
  REGCHAIN_LOGIN_ATTEMPTS: "3", REGCHAIN_LOGIN_ATTEMPTS_PER_ADDRESS: "12", REGCHAIN_WRITES_PER_MINUTE: "60", REGCHAIN_LOG_LEVEL: "warn", ANTHROPIC_API_KEY: "" };
const users = (args, extra = {}) => spawnSync(process.execPath, [join(root, "scripts", "users.mjs"), ...args], { env: { ...env, ...extra }, encoding: "utf8" });
{
  for (const [username, name, role] of [["sam.supply", "Sam Supply", "viewer"], ["rita.reg", "Rita Regulatory", "reviewer"], ["olga.owner", "Olga Owner", "owner"]]) {
    const result = users(["add", username, name, role], { REGCHAIN_NEW_PASSWORD: username + "-password" });
    assert.equal(result.status, 0, result.stderr);
  }
  const generated = users(["add", "vic.verify", "Vic Verifier", "verifier"]);
  assert.equal(generated.status, 0, generated.stderr);
  var vicPassword = generated.stdout.match(/shown once: (\S+)/)?.[1];
  assert.ok(vicPassword && vicPassword.length >= 12, "a generated password is printed once");
  assert.notEqual(users(["add", "short.pw", "Short", "viewer"], { REGCHAIN_NEW_PASSWORD: "short" }).status, 0, "the CLI refuses a short password");
  assert.match(users(["list"]).stdout, /vic\.verify/);
  console.log("ok  users command: adds people with one role each, prints a generated password once, refuses short passwords");
}

const server = spawn(process.execPath, [join(root, "serve-regchain.cjs")], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let serverOutput = "";
server.stdout.on("data", chunk => { serverOutput += chunk; });
server.stderr.on("data", chunk => { serverOutput += chunk; });
const exited = new Promise(resolve => server.once("exit", resolve));

function call(method, path, { body, headers = {}, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
    const request = httpRequest({ host: "127.0.0.1", port, method, path, headers: { Host: `127.0.0.1:${port}`,
      ...(data !== null ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers } }, response => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { text += chunk; });
      response.on("end", () => { let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: response.statusCode, headers: response.headers, text, json }); });
    });
    request.on("error", reject);
    if (data !== null) request.write(data);
    request.end();
  });
}
async function signInAs(username, password) {
  const response = await call("POST", "/v1/auth/login", { body: { username, password } });
  assert.equal(response.status, 200, `${username} signs in: ${response.text}`);
  return { response, cookie: String(response.headers["set-cookie"]).split(";")[0] };
}

try {
  let health = null;
  for (let attempt = 0; attempt < 120 && !health; attempt += 1) {
    health = await call("GET", "/v1/health", { headers: { "X-Request-Id": "security-check-0001" } }).catch(() => null);
    if (health?.status !== 200) { health = null; await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert.ok(health, "the server answers /v1/health\n" + serverOutput);
  assert.deepEqual([health.json.status, health.json.audit.ok], ["ok", true]);
  assert.equal(health.headers["x-request-id"], "security-check-0001", "a caller's request ID is kept for tracing");
  assert.equal(health.headers["x-content-type-options"], "nosniff");
  assert.equal(health.headers["x-frame-options"], "DENY");
  assert.equal((await call("GET", "/v1/health", { headers: { Host: "evil.example" } })).status, 400, "an unknown Host header is refused");

  // Before signing in: the sign-in page only, no data, no API.
  const front = await call("GET", "/");
  assert.equal(front.status, 200);
  assert.match(front.text, /id="signin"/);
  assert.ok(!front.text.includes("portfolio-data"), "the dashboard and its data are not sent before sign-in");
  const frontNonce = front.headers["content-security-policy"].match(/'nonce-([^']+)'/)[1];
  assert.ok(front.text.includes(`nonce="${frontNonce}"`));
  assert.match((await call("GET", "/RegChain-AI-Dashboard.html")).text, /id="signin"/);
  for (const [method, path] of [["GET", "/v1/cases"], ["GET", "/v1/audit/verify"], ["GET", "/v1/shipment-actions"], ["GET", "/api/agent/approvals"], ["GET", "/api/agent/plans"]]) {
    assert.equal((await call(method, path)).status, 401, `${method} ${path} needs sign-in`);
  }
  assert.equal((await call("POST", "/api/ai/analyze", { body: {} })).status, 401, "the AI check needs sign-in");
  assert.equal((await call("GET", "/v1/openapi.json")).status, 200);
  assert.deepEqual([(await call("GET", "/v1/session")).json.mode, (await call("GET", "/v1/session")).json.user], ["password", null]);

  // Sign-in requests: same site, JSON, valid shape, right password.
  assert.equal((await call("POST", "/v1/auth/login", { body: { username: "sam.supply", password: "sam.supply-password" }, headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await call("POST", "/v1/auth/login", { body: { username: "sam.supply", password: "sam.supply-password" }, headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await call("POST", "/v1/auth/login", { body: "username=sam.supply", headers: { "Content-Type": "text/plain" } })).status, 415);
  const malformed = await call("POST", "/v1/auth/login", { body: { username: 5, password: "x" } });
  assert.equal(malformed.status, 422);
  assert.match(malformed.json.error, /Invalid request: username/);
  assert.equal((await call("POST", "/v1/auth/login", { body: { username: "sam.supply", password: "not-the-password" } })).status, 401);
  console.log("ok  before sign-in: only the sign-in page, no data, every API and agent route answers 401, sign-in is same-site JSON");

  const sam = await signInAs("sam.supply", "sam.supply-password");
  const setCookie = String(sam.response.headers["set-cookie"]);
  for (const flag of ["HttpOnly", "SameSite=Strict", "Max-Age=43200", "Path=/"]) assert.ok(setCookie.includes(flag), "session cookie has " + flag);
  assert.ok(!setCookie.includes("Secure"), "no Secure flag on plain HTTP at 127.0.0.1");
  assert.deepEqual([sam.response.json.user.name, sam.response.json.role], ["Sam Supply", "viewer"]);
  const page = await call("GET", "/", { cookie: sam.cookie });
  assert.ok(page.text.includes("portfolio-data"), "the dashboard is served after sign-in");
  const pageNonce = page.headers["content-security-policy"].match(/'nonce-([^']+)'/)[1];
  assert.notEqual(pageNonce, frontNonce, "a new nonce for every page");
  assert.equal((page.text.match(/<script\b/g) ?? []).length, (page.text.match(new RegExp(`<script nonce="${pageNonce.replace(/[+/=]/g, "\\$&")}"`, "g")) ?? []).length, "every script carries this page's nonce");
  assert.equal(page.headers["cache-control"], "no-store");
  assert.equal((await call("GET", "/signin", { cookie: sam.cookie })).status, 302);
  assert.equal((await call("GET", "/v1/session", { cookie: sam.cookie })).json.user.name, "Sam Supply");
  assert.equal((await call("POST", "/v1/session", { cookie: sam.cookie, body: { role: "reviewer" } })).status, 403, "a signed-in person cannot switch role");
  assert.equal((await call("GET", "/v1/cases", { cookie: sam.cookie })).status, 200);
  assert.equal((await call("POST", "/v1/cases/uk/reset", { cookie: sam.cookie, body: {} })).status, 403, "Clinical Supply cannot start a case again");
  const invalid = await call("POST", "/v1/cases/uk/commands", { cookie: sam.cookie, body: { action: "explode", revision: 1 }, headers: { "Idempotency-Key": "security-check-invalid" } });
  assert.equal(invalid.status, 422);
  assert.match(invalid.json.error, /action/);
  assert.equal((await call("POST", "/api/agent/start-fresh", { cookie: sam.cookie, body: { plans: true } })).status, 403, "no wiping approvals on a shared deployment");
  console.log("ok  signed in as Clinical Supply: HttpOnly SameSite=Strict cookie, the page with a fresh script nonce, role fixed by the account");

  const rita = await signInAs("rita.reg", "rita.reg-password");
  assert.equal((await call("POST", "/api/agent/approve", { cookie: rita.cookie, body: { shipment: "SHP-1", option: "hold" } })).status, 403, "only Clinical Supply approves supply plans");
  assert.equal((await call("POST", "/v1/cases/uk/reset", { cookie: rita.cookie, body: {} })).status, 200);
  const entries = (await call("GET", "/v1/cases/uk/audit", { cookie: rita.cookie })).json.entries;
  assert.match(entries.filter(entry => entry.type === "case.reset").at(-1).actor, /^Rita Regulatory · /, "the audit trail names the signed-in person");

  const out = await call("POST", "/v1/auth/logout", { cookie: sam.cookie, body: {} });
  assert.equal(out.status, 200);
  assert.match(String(out.headers["set-cookie"]), /Max-Age=0/);
  assert.equal((await call("GET", "/v1/cases", { cookie: sam.cookie })).status, 401, "a signed-out session no longer works");

  for (let attempt = 1; attempt <= 3; attempt += 1) assert.equal((await call("POST", "/v1/auth/login", { body: { username: "olga.owner", password: "wrong-" + attempt } })).status, 401);
  assert.equal((await call("POST", "/v1/auth/login", { body: { username: "olga.owner", password: "olga.owner-password" } })).status, 429, "locked after 3 failures");
  await signInAs("vic.verify", vicPassword);
  console.log("ok  roles and sign-out: approvals stay with Clinical Supply, the audit names the person, sign-out ends the session, lockout works");

  const backupDir = join(temp, "backups");
  const backup = spawnSync(process.execPath, [join(root, "scripts", "backup.mjs"), backupDir], { env, encoding: "utf8" });
  assert.equal(backup.status, 0, backup.stderr);
  assert.match(backup.stdout, /chain intact/);
  const copyFile = (await readdir(backupDir)).find(name => name.endsWith(".db"));
  const copy = new DatabaseSync(join(backupDir, copyFile), { readOnly: true });
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM app_user").get().n, 4);
  assert.equal(verifyAudit(copy).ok, true);
  copy.close();
  console.log("ok  backup while running: a consistent copy with all users and an intact audit chain, plus the cache");

  let limited = null;
  for (let attempt = 0; attempt < 80 && !limited; attempt += 1) {
    const response = await call("POST", "/v1/auth/logout", { body: {} });
    if (response.status === 429) limited = response;
  }
  assert.ok(limited, "writes are limited per client");
  assert.ok(Number(limited.headers["retry-after"]) > 0, "with a Retry-After header");
  assert.equal((await call("GET", "/v1/health")).json.audit.ok, true, "reads still work and the audit chain is intact");
  console.log("ok  write rate limit: 429 with Retry-After once a client passes its writes per minute");
} finally {
  server.kill();
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
}
console.log("Security checks passed.");
