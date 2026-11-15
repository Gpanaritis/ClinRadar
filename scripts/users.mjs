// Manage the named users of a shared deployment (REGCHAIN_AUTH=password).
//   node scripts/users.mjs add <username> "<Full name>" <role>     role: viewer (Clinical Supply), reviewer (Regulatory SME), owner (Quality owner), verifier (Quality verifier)
//   node scripts/users.mjs list
//   node scripts/users.mjs password <username>
//   node scripts/users.mjs disable <username> | enable <username>
// A new password comes from REGCHAIN_NEW_PASSWORD, or is generated and printed once. Every change is in the audit trail.

import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDatabase, openDatabase } from "../regchain-ai/db.mjs";
import { createUser, listUsers, setActive, setPassword, ROLE_IDS } from "../regchain-ai/auth.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...args] = process.argv.slice(2);
const db = openDatabase(root);
const newPassword = () => process.env.REGCHAIN_NEW_PASSWORD || randomBytes(15).toString("base64url");
const usage = () => {
  console.log(`Usage:\n  node scripts/users.mjs add <username> "<Full name>" <${ROLE_IDS.join("|")}>\n  node scripts/users.mjs list\n  node scripts/users.mjs password <username>\n  node scripts/users.mjs disable <username>\n  node scripts/users.mjs enable <username>`);
  process.exitCode = 1;
};
try {
  if (command === "add" && args.length === 3) {
    const password = newPassword();
    const user = createUser(db, { username: args[0], name: args[1], role: args[2], password });
    console.log(`Created ${user.username} (${user.name}, ${user.role}).`);
    if (!process.env.REGCHAIN_NEW_PASSWORD) console.log(`Password, shown once: ${password}`);
  } else if (command === "list") {
    console.table(listUsers(db));
  } else if (command === "password" && args.length === 1) {
    const password = newPassword();
    setPassword(db, args[0], password);
    console.log(`Password changed for ${args[0]}; their sessions were ended.`);
    if (!process.env.REGCHAIN_NEW_PASSWORD) console.log(`New password, shown once: ${password}`);
  } else if ((command === "disable" || command === "enable") && args.length === 1) {
    setActive(db, args[0], command === "enable");
    console.log(`${args[0]} ${command}d.`);
  } else usage();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  closeDatabase(root);
}
