// Create the four named demo accounts for password mode (REGCHAIN_AUTH=password), one role each, in the current data dir.
//   node scripts/demo-accounts.mjs            creates the accounts that are missing and leaves existing ones as they are
//   node scripts/demo-accounts.mjs --reset    also gives every existing demo account a new password (ends its sessions)
// New passwords are printed once and kept in <data dir>/demo-accounts.txt, next to the database and outside Git.
// Uses the same user store as scripts/users.mjs, so every change is in the audit trail.

import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The same .env as the server, so both open the same database.
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const { closeDatabase, dataDir, openDatabase } = await import("../regchain-ai/db.mjs");
const { createUser, listUsers, setPassword } = await import("../regchain-ai/auth.mjs");

const DEMO_ACCOUNTS = [
  { username: "p.laine", name: "P. Laine", role: "viewer", title: "Clinical Supply" },
  { username: "a.novak", name: "A. Novak", role: "reviewer", title: "Regulatory SME" },
  { username: "m.okafor", name: "M. Okafor", role: "owner", title: "Quality owner" },
  { username: "l.chen", name: "L. Chen", role: "verifier", title: "Quality verifier" },
];

// Four groups of four from an alphabet without look-alikes (no 0/O, 1/l/I): 19 characters, about 79 bits.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const readablePassword = () => Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")).join("-");

const reset = process.argv.includes("--reset");
const dir = dataDir(root);
const file = join(dir, "demo-accounts.txt");

// What the file already holds, by username, so passwords from an earlier run stay listed.
const known = new Map();
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const [username, password] = line.split("\t");
    if (username && password && !line.startsWith("#")) known.set(username, password);
  }
}

mkdirSync(dir, { recursive: true });
const db = openDatabase(root);
const shown = [];
try {
  const existing = new Set(listUsers(db).map(user => user.username));
  for (const account of DEMO_ACCOUNTS) {
    if (!existing.has(account.username)) {
      const password = readablePassword();
      createUser(db, { username: account.username, name: account.name, role: account.role, password });
      known.set(account.username, password);
      shown.push({ ...account, password, change: "created" });
    } else if (reset) {
      const password = readablePassword();
      setPassword(db, account.username, password);
      known.set(account.username, password);
      shown.push({ ...account, password, change: "new password" });
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  closeDatabase(root);
}

const lines = [
  "# SupplyShield demo accounts for password mode (REGCHAIN_AUTH=password). Keep this file private; it is outside Git.",
  "# Sign in at http://127.0.0.1:4173/ . Reset all passwords with: npm run demo:accounts -- --reset",
  "# username\tpassword\tname\trole",
  ...DEMO_ACCOUNTS.map(account => [account.username, known.get(account.username) ?? "(not recorded here: run with --reset)", account.name, account.title + " (" + account.role + ")"].join("\t")),
];
writeFileSync(file, lines.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });

if (shown.length) {
  console.log("Demo accounts (passwords shown once; also kept in " + file + "):");
  for (const account of shown) console.log(`  ${account.username.padEnd(9)} ${account.password}  ${account.name}, ${account.title} (${account.change})`);
} else {
  console.log("The four demo accounts already exist. Their passwords are in " + file + " (run with --reset for new ones).");
}
