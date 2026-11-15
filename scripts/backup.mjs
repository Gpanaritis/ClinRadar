// Back up RegChain while it runs: a consistent copy of the database (SQLite VACUUM INTO), checked by
// recomputing its audit chain, plus the source and agent-run cache.
//   node scripts/backup.mjs [target folder]      default: ./backups
// To restore: stop RegChain, copy the .db file back to REGCHAIN_DATA_DIR/regchain.db (and the cache folder to
// REGCHAIN_CACHE_DIR), start RegChain, and open /v1/health to confirm the audit chain.

import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { closeDatabase, openDatabase, verifyAudit } from "../regchain-ai/db.mjs";
import { cacheDir } from "../regchain-ai/sources.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(process.argv[2] ?? join(root, "backups"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
await mkdir(target, { recursive: true });
const file = join(target, `regchain-${stamp}.db`);
const db = openDatabase(root);
db.prepare("VACUUM INTO ?").run(file);
closeDatabase(root);
// Check the copy, not the original: a backup is only useful if it is whole.
const copy = new DatabaseSync(file, { readOnly: true });
const chain = verifyAudit(copy);
copy.close();
if (!chain.ok) {
  console.error(`The backup's audit chain is broken at entry ${chain.brokenAt}. Keep the original and investigate.`);
  process.exit(1);
}
if (existsSync(cacheDir(root))) await cp(cacheDir(root), join(target, `cache-${stamp}`), { recursive: true });
console.log(`Backed up to ${file} (${chain.entries} audit entries, chain intact)${existsSync(cacheDir(root)) ? ` and cache-${stamp}` : ""}.`);
