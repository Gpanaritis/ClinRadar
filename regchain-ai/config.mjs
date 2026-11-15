// Every setting RegChain reads from the environment, in one place, with safe defaults for one person on one computer.
// A shared deployment sets REGCHAIN_AUTH=password and REGCHAIN_PUBLIC_ORIGIN (see RegChain-AI-Deployment.md).

const bool = value => ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
const number = (value, fallback) => (Number.isFinite(Number(value)) && String(value ?? "").trim() !== "" ? Number(value) : fallback);

export function loadConfig(env = process.env) {
  const host = env.REGCHAIN_HOST || "127.0.0.1";
  const port = number(env.REGCHAIN_PORT, 4173);
  const localOrigin = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;
  const publicOrigin = (env.REGCHAIN_PUBLIC_ORIGIN || "").replace(/\/+$/, "") || null;
  // local: one person on their own computer, choosing a role with "Acting as". password: named users sign in.
  const auth = env.REGCHAIN_AUTH === "password" ? "password" : "local";
  if (auth === "local" && host !== "127.0.0.1" && host !== "localhost" && !bool(env.REGCHAIN_ALLOW_LOCAL_AUTH_ON_NETWORK)) {
    throw new Error("REGCHAIN_AUTH=local only serves this computer. Set REGCHAIN_AUTH=password to listen on " + host + ".");
  }
  const origins = [localOrigin, `http://localhost:${port}`, ...(publicOrigin ? [publicOrigin] : [])];
  return {
    host, port, auth, publicOrigin, origins,
    hosts: origins.map(origin => new URL(origin).host),
    secureCookies: Boolean(publicOrigin?.startsWith("https://")),
    trustProxy: bool(env.REGCHAIN_TRUST_PROXY),
    sessionIdleMinutes: number(env.REGCHAIN_SESSION_IDLE_MINUTES, 480),
    sessionMaxHours: number(env.REGCHAIN_SESSION_MAX_HOURS, 12),
    loginAttempts: number(env.REGCHAIN_LOGIN_ATTEMPTS, 5),
    // Per client address, across usernames: catches someone trying one password on many accounts, without one
    // person's typos locking out a whole office that reaches RegChain through the same address.
    loginAttemptsPerAddress: number(env.REGCHAIN_LOGIN_ATTEMPTS_PER_ADDRESS, 20),
    loginLockMinutes: number(env.REGCHAIN_LOGIN_LOCK_MINUTES, 15),
    writesPerMinute: number(env.REGCHAIN_WRITES_PER_MINUTE, 120),
    logFormat: env.REGCHAIN_LOG_FORMAT === "text" ? "text" : "json",
    logLevel: env.REGCHAIN_LOG_LEVEL || "info",
  };
}
