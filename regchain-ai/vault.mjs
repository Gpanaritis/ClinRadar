// The Claude API key an administrator connects in Settings, kept on the server only.
//
// - Encrypted at rest with AES-256-GCM. The encryption key comes from REGCHAIN_SECRET_KEY (32 bytes, base64) or, if that
//   is unset, from a random key generated once in the data folder (vault.key). Both files live in the data folder, which
//   Git ignores and the database backup does not copy.
// - The key never leaves the server: the page, the API, the logs and the audit trail only ever see its last four
//   characters, who connected it and when.
// - Only the Claude API (Anthropic) uses a connected key. A key in the server's .env file still wins, as before.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./db.mjs";

const KEY_FILE = "claude-key.enc.json";
const SECRET_FILE = "vault.key";
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

// An Anthropic API key: "sk-ant-" and then letters, digits, dashes and underscores. Nothing else is stored.
export function checkKeyFormat(key) {
  const value = String(key ?? "").trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(value)) throw fail(422, "That is not an Anthropic API key. It starts with sk-ant- and has no spaces.");
  return value;
}

function writePrivate(file, text) {
  const temp = file + "." + randomBytes(6).toString("hex") + ".tmp";
  writeFileSync(temp, text, { mode: 0o600 });
  renameSync(temp, file);
}

function secret(root) {
  const fromEnv = String(process.env.REGCHAIN_SECRET_KEY ?? "").trim();
  if (fromEnv) {
    const key = Buffer.from(fromEnv, "base64");
    if (key.length !== 32) throw fail(500, "REGCHAIN_SECRET_KEY must be 32 bytes, base64-encoded.");
    return key;
  }
  const dir = dataDir(root);
  const file = join(dir, SECRET_FILE);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writePrivate(file, randomBytes(32).toString("base64"));
  }
  return Buffer.from(readFileSync(file, "utf8").trim(), "base64");
}

function readRecord(root) {
  try {
    return JSON.parse(readFileSync(join(dataDir(root), KEY_FILE), "utf8"));
  } catch {
    return null;
  }
}

// What may be shown about the key: never the key itself.
export function claudeKeyInfo(root) {
  const record = readRecord(root);
  return record ? { set: true, last4: record.last4, by: record.by, at: record.at, checked: record.checked } : { set: false };
}

export function saveClaudeKey(root, key, { by, checked }) {
  const value = checkKeyFormat(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret(root), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const record = { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64"),
    last4: value.slice(-4), by, at: new Date().toISOString(), checked: Boolean(checked) };
  mkdirSync(dataDir(root), { recursive: true });
  writePrivate(join(dataDir(root), KEY_FILE), JSON.stringify(record));
  return claudeKeyInfo(root);
}

// The key for a live run, or null. A file that does not decrypt (a changed REGCHAIN_SECRET_KEY) counts as no key.
export function readClaudeKey(root) {
  const record = readRecord(root);
  if (!record) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", secret(root), Buffer.from(record.iv, "base64"));
    decipher.setAuthTag(Buffer.from(record.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(record.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function removeClaudeKey(root) {
  const record = readRecord(root);
  try { unlinkSync(join(dataDir(root), KEY_FILE)); } catch {}
  return record ? { removed: true, last4: record.last4 } : { removed: false };
}
