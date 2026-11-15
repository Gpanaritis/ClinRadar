// Named users, sign-in and sessions for a shared deployment (REGCHAIN_AUTH=password).
// Passwords are stored as scrypt hashes with a random salt; comparison is constant-time. Each user holds exactly one
// role, so the approver, the Quality owner and the verifier are always different people. Repeated failures lock the
// account and the client address for a while. Every sign-in, failure and sign-out is in the audit trail.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { userInfo } from "node:os";
import { appendAudit, newId, transaction } from "./db.mjs";

export const ROLE_IDS = ["viewer", "reviewer", "owner", "verifier"];
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const PASSWORD_RULE = "at least 12 characters";

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}
export function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored ?? "").split("$");
  if (kind !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const actual = scryptSync(String(password), Buffer.from(salt, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
// User changes are made on the server with scripts/users.mjs: the audit names the operating-system account that ran it.
const administrator = () => { try { return `RegChain administrator (${userInfo().username})`; } catch { return "RegChain administrator"; } };
function checkPassword(password) {
  if (String(password ?? "").length < 12) throw fail(422, `The password needs ${PASSWORD_RULE}.`);
}
// Something to burn the same time on when the username does not exist, so timing does not reveal valid usernames.
const DUMMY = hashPassword(randomBytes(12).toString("hex"));

export function createUser(db, { username, name, role, password, admin = false }) {
  if (!/^[a-z0-9._-]{3,40}$/i.test(String(username ?? ""))) throw fail(422, "The username needs 3 to 40 letters, digits, dots, dashes or underscores.");
  if (!String(name ?? "").trim()) throw fail(422, "Give the person's name as it should appear in the audit trail.");
  if (!ROLE_IDS.includes(role)) throw fail(422, "The role must be one of " + ROLE_IDS.join(", ") + ".");
  checkPassword(password);
  if (db.prepare("SELECT 1 FROM app_user WHERE username = ?").get(username)) throw fail(409, "That username is taken.");
  const now = new Date().toISOString();
  const id = newId("usr");
  transaction(db, () => {
    db.prepare("INSERT INTO app_user (id, username, name, role, password_hash, created_at, password_changed_at, admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, username, String(name).trim(), role, hashPassword(password), now, now, admin ? 1 : 0);
    appendAudit(db, { actor: administrator(), type: "user.created", subjectType: "user", subjectId: id, detail: `${username} · ${role}${admin ? " · administrator" : ""}` });
  });
  return { id, username, name: String(name).trim(), role, admin: Boolean(admin) };
}
// An administrator connects Claude in Settings and may start live AI runs. It is a flag on top of the person's one role:
// it grants no approval, so the four-eyes rules between the roles still hold. Changing it ends their sessions.
export function setAdmin(db, username, admin) {
  const user = db.prepare("SELECT id FROM app_user WHERE username = ?").get(username);
  if (!user) throw fail(404, "No such user.");
  transaction(db, () => {
    db.prepare("UPDATE app_user SET admin = ? WHERE id = ?").run(admin ? 1 : 0, user.id);
    db.prepare("DELETE FROM session WHERE user_id = ?").run(user.id);
    appendAudit(db, { actor: administrator(), type: admin ? "user.admin_granted" : "user.admin_removed", subjectType: "user", subjectId: user.id, detail: username });
  });
}
export function setPassword(db, username, password) {
  checkPassword(password);
  const user = db.prepare("SELECT id FROM app_user WHERE username = ?").get(username);
  if (!user) throw fail(404, "No such user.");
  transaction(db, () => {
    db.prepare("UPDATE app_user SET password_hash = ?, password_changed_at = ? WHERE id = ?").run(hashPassword(password), new Date().toISOString(), user.id);
    db.prepare("DELETE FROM session WHERE user_id = ?").run(user.id);
    appendAudit(db, { actor: administrator(), type: "user.password_reset", subjectType: "user", subjectId: user.id, detail: username });
  });
}
export function setActive(db, username, active) {
  const user = db.prepare("SELECT id FROM app_user WHERE username = ?").get(username);
  if (!user) throw fail(404, "No such user.");
  transaction(db, () => {
    db.prepare("UPDATE app_user SET active = ? WHERE id = ?").run(active ? 1 : 0, user.id);
    if (!active) db.prepare("DELETE FROM session WHERE user_id = ?").run(user.id);
    appendAudit(db, { actor: administrator(), type: active ? "user.enabled" : "user.disabled", subjectType: "user", subjectId: user.id, detail: username });
  });
}
export function setRole(db, username, role) {
  if (!ROLE_IDS.includes(role)) throw fail(422, "The role must be one of " + ROLE_IDS.join(", ") + ".");
  const user = db.prepare("SELECT id, role FROM app_user WHERE username = ?").get(username);
  if (!user) throw fail(404, "No such user.");
  transaction(db, () => {
    db.prepare("UPDATE app_user SET role = ? WHERE id = ?").run(role, user.id);
    db.prepare("DELETE FROM session WHERE user_id = ?").run(user.id);
    appendAudit(db, { actor: administrator(), type: "user.role_changed", subjectType: "user", subjectId: user.id, detail: `${username} · ${user.role} → ${role}` });
  });
}
export const listUsers = db => db.prepare("SELECT id, username, name, role, admin, active, created_at, last_sign_in FROM app_user ORDER BY username").all();

function recentFailures(db, key, since) {
  return db.prepare("SELECT COUNT(*) AS n FROM login_attempt WHERE key = ? AND ok = 0 AND at >= ?").get(key, since).n;
}
export function signIn(db, config, { username, password, address }) {
  const now = new Date();
  const since = new Date(now - config.loginLockMinutes * 60000).toISOString();
  // Attempts older than a day are no longer needed for lockout.
  db.prepare("DELETE FROM login_attempt WHERE at < ?").run(new Date(now - 86400000).toISOString());
  const keys = [`user:${String(username ?? "").toLowerCase()}`, `address:${address}`];
  const limits = [config.loginAttempts, config.loginAttemptsPerAddress ?? config.loginAttempts * 4];
  if (keys.some((key, index) => recentFailures(db, key, since) >= limits[index])) {
    appendAudit(db, { actor: String(username ?? ""), type: "auth.sign_in_locked", subjectType: "user", subjectId: String(username ?? ""), detail: "Too many failed attempts", data: { address } });
    throw fail(429, `Too many failed attempts. Try again in ${config.loginLockMinutes} minutes.`);
  }
  const user = db.prepare("SELECT * FROM app_user WHERE username = ?").get(String(username ?? ""));
  const ok = user ? verifyPassword(password, user.password_hash) && user.active === 1 : (verifyPassword(password, DUMMY), false);
  const at = now.toISOString();
  if (!ok) {
    transaction(db, () => {
      for (const key of keys) db.prepare("INSERT INTO login_attempt (key, at, ok) VALUES (?, ?, 0)").run(key, at);
      appendAudit(db, { actor: String(username ?? ""), type: "auth.sign_in_failed", subjectType: "user", subjectId: user?.id ?? String(username ?? ""), detail: user && !user.active ? "Account disabled" : "Wrong username or password", data: { address } });
    });
    throw fail(401, "Wrong username or password.");
  }
  const id = randomBytes(32).toString("hex");
  const expires = new Date(now.getTime() + config.sessionMaxHours * 3600000).toISOString();
  transaction(db, () => {
    db.prepare("INSERT INTO session (id, role, created_at, last_seen, user_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, user.role, at, at, user.id, expires);
    db.prepare("UPDATE app_user SET last_sign_in = ? WHERE id = ?").run(at, user.id);
    db.prepare("DELETE FROM login_attempt WHERE key = ?").run(keys[0]);
    appendAudit(db, { actor: user.name, role: user.role, type: "auth.signed_in", subjectType: "user", subjectId: user.id, detail: user.username, data: { address } });
  });
  return { sessionId: id, user: { id: user.id, username: user.username, name: user.name, role: user.role, admin: user.admin === 1 }, expiresAt: expires };
}
// The session behind a cookie, if it is still valid. Expired sessions are removed.
export function sessionFor(db, config, sessionId) {
  if (!sessionId) return null;
  const row = db.prepare(`SELECT s.*, u.username, u.name, u.role AS user_role, u.active, u.admin FROM session s LEFT JOIN app_user u ON u.id = s.user_id WHERE s.id = ?`).get(sessionId);
  if (!row) return null;
  const now = Date.now();
  if (config.auth === "password") {
    const idle = Date.parse(row.last_seen) + config.sessionIdleMinutes * 60000 < now;
    const expired = row.expires_at && Date.parse(row.expires_at) < now;
    if (!row.user_id || row.active !== 1 || idle || expired) {
      db.prepare("DELETE FROM session WHERE id = ?").run(row.id);
      return null;
    }
  }
  db.prepare("UPDATE session SET last_seen = ? WHERE id = ?").run(new Date(now).toISOString(), row.id);
  return { id: row.id, role: row.user_id ? row.user_role : row.role, user: row.user_id ? { id: row.user_id, username: row.username, name: row.name, admin: row.admin === 1 } : null };
}
export function signOut(db, session) {
  if (!session) return;
  transaction(db, () => {
    db.prepare("DELETE FROM session WHERE id = ?").run(session.id);
    appendAudit(db, { actor: session.user?.name ?? "local session", role: session.role, type: "auth.signed_out", subjectType: "user", subjectId: session.user?.id ?? session.id });
  });
}
