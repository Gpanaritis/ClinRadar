# Security policy

## Reporting a vulnerability

Report security problems privately to the repository maintainers. Do not describe them in an issue, pull request or discussion.

Please include:

- what you found and where (file, route or screen);
- the steps to reproduce it;
- the commit you tested;
- what an attacker could do with it.

Give the maintainers time to fix the problem before you share the details with anyone else.

## Supported versions

Only the `main` branch is supported. Fixes are made there. There are no maintained releases.

## Security model

RegChain AI is a prototype. This is a summary. The settings and their defaults are in [RegChain-AI-Deployment.md](RegChain-AI-Deployment.md), and the gaps for regulated use are in [RegChain-AI-Validation.md](RegChain-AI-Validation.md).

- **Two modes.** `REGCHAIN_AUTH=local` has no sign-in: whoever uses the computer picks a role. It listens only on `127.0.0.1` or `localhost`. `REGCHAIN_AUTH=password` is for teams: named users sign in.
- **Passwords.** Salted scrypt hashes, compared in constant time. At least 12 characters. An unknown username gets the same answer as a wrong password.
- **Lockout.** Repeated failures lock the username (5 by default) and the client address (20, across usernames) for 15 minutes. Every sign-in, failure, lockout and sign-out is in the audit trail.
- **Sessions.** In password mode, a random 256-bit session ID in an HttpOnly, SameSite=Strict cookie, with the Secure flag over HTTPS. A session ends after 8 hours idle or 12 hours in total, and when the account is disabled or its password changes.
- **Authorisation.** Every route needs a signed-in user except `GET /v1/health`, `GET /v1/session`, `POST /v1/auth/login` and `GET /v1/openapi.json`. The role comes from the account and is checked on the server; each route that starts work belongs to one role. Each account has one role, so the approver, the Quality owner and the verifier are different accounts.
- **Requests.** Unknown `Host` headers are refused. Writes must be JSON from the same site (`Origin` and `Sec-Fetch-Site` are checked). Request bodies are validated against schemas and size-limited, writes to `/v1` and `/api` routes that start work are rate-limited per client address, and an `Idempotency-Key` stops a retried write from applying twice.
- **Pages.** A Content Security Policy that runs only scripts carrying the page's own nonce, new for every page. No framing, no MIME sniffing, no referrer, same-origin opener and resource policies, camera, microphone, location, payment and USB turned off, and HSTS over HTTPS.
- **Records.** One SQLite database. The audit trail is append-only (database triggers refuse changes) and hash-chained. `/v1/health` and `/v1/audit/verify` recompute the chain, and `/v1/health` answers 503 when it is broken.
- **AI and agents.** The Anthropic API key stays on the server. It is never sent to the page or to the MCP server processes. The MCP servers are read-only except for a draft inbox. AI output is a draft, checked by fixed rules and decided by a person.

Known limits:

- No single sign-on, second factor or electronic signatures.
- One instance: the write rate limit is kept in memory.
- TLS is the reverse proxy's job. RegChain itself serves plain HTTP.
- `/v1/health` is public. Before sign-in it shows only whether the audit chain is intact.
- Someone with direct access to the database file could rewrite the audit chain as a whole. Restrict file access and keep the latest hash somewhere else.
