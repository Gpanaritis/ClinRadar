# RegChain AI · Validation outline for GxP use

*15 November 2026. An outline for a company that wants to use RegChain in GxP work. It is not a completed validation: no protocol has been written or executed, nothing has been approved, and no part of this document is a validation record. It describes what the code in this repository does today and what is still missing.*

## Intended use

RegChain supports Regulatory Affairs, Clinical Supply and Quality in clinical trial supply:

- It monitors official sources and finds the changes that matter for a company requirement.
- AI drafts the change from the official text. Deterministic checks verify the draft. A Regulatory SME approves, edits or rejects it.
- An approved change publishes the next requirement version and Country Specification version, and assigns a Quality task.
- It checks every planned shipment against its destination's Country Specification before it leaves the depot.
- AI agents propose plans for blocked shipments and draft the changes. Clinical Supply approves a plan.

What RegChain does not do:

- It never releases, certifies or ships a batch or a shipment.
- It does not change IRT, ERP, the depot, the eTMF or the QMS. The agents read those systems and write only drafts, into a separate inbox.
- An approval in RegChain changes nothing in a validated system. Each draft is still approved in that system, under its own change control and signatures.
- It is not the system of record for the data held in those systems.

RegChain is the system of record for what it owns: source versions and evidence, change cases, proposals, decisions, published requirement and specification versions, impact findings, shipment actions, agent plan approvals, user accounts, the audit trail and the event outbox.

## GAMP 5 categorisation and approach

- **Category 5, custom application.** RegChain's code was written for this purpose. Its runtime (Node.js), database engine (SQLite through `node:sqlite`) and libraries (`zod`, the MCP SDK, the Anthropic SDK) can be treated as infrastructure and standard components, identified by the exact versions in `package-lock.json`.
- **The AI model is an external service.** It needs a supplier assessment and an agreement with the provider, as for any service provider under Annex 11 §3. The provider is whoever runs the chosen Claude service: Anthropic, or the company's cloud provider for Amazon Bedrock, Google Cloud Vertex AI and Microsoft Foundry.
- **Risk-based approach.** Following GAMP 5 (second edition), effort goes where patient safety, product quality and data integrity are affected. A starting point for the risk assessment:

| Function | Why it matters | Suggested rigour |
|---|---|---|
| Publishing requirement and specification versions | Shipments are checked against them | High |
| Shipment check results and agent plan approvals | They inform whether a shipment proceeds | High |
| Audit trail, access control and sessions | Data integrity and attribution | High |
| Deterministic checks on AI drafts and agent options | They decide whether a draft or option can be approved | High |
| The AI draft itself | A person reviews it before anything is published | Medium |
| Dashboards, filters and layout | Presentation only | Low |

## Qualification mapped to what exists

### Installation qualification (IQ)

What exists today:

- The Docker image, built with `npm ci` from the locked dependency versions. It runs as a non-root user and keeps all data in one volume.
- The image's health check: `/v1/health` must answer 200, which needs an intact audit chain (a broken chain answers 503).
- `schema_version` in `/v1/health` (2 for this version) confirms that the migrations ran.

The IQ should record the commit, the image digest, the Node.js version, the settings (`REGCHAIN_AUTH=password`, an `https://` `REGCHAIN_PUBLIC_ORIGIN`, the proxy settings, the data and cache folders), the proxy and certificate configuration, and the accounts created for each role. [RegChain-AI-Deployment.md](RegChain-AI-Deployment.md) describes each setting.

### Operational qualification (OQ)

The automated checks run in temporary folders with fictional data. CI (`.github/workflows/checks.yml`) runs the offline checks on every push to `main` and every pull request. It also runs `check:ai`, which needs the network, but a failure there does not block a merge.

| Script | What it proves |
|---|---|
| `npm run check:data` | The data copies embedded in the dashboard page match the files in `demo-data/` |
| `npm run check:server` | Migrations run. Audit entries cannot be changed or deleted, and a tampered entry breaks the chain. Approvals from earlier versions are imported once. The server's workflow gives the same states and refusals as the page's own code. The UK impact matches the acceptance answer key. The pipeline detects a change once and ignores whitespace. The `/v1` API returns 401, 403, 409 and 422 where it should, refuses other sites, keeps decisions idempotent, delivers outbox events, blocks closure while shipments are blocked, and ends with an intact audit chain |
| `npm run check:security` | Settings, salted scrypt hashes, the 12-character minimum, one valid role per user, lockout per username and per address, idle and maximum session length, and sessions ended by disabling a user or changing a password. Security headers, the script nonce and the rate limiter. Then the real server in password mode: sign-in gating, one role for each route that starts work, same-site and input checks, sign-out, the users command, a backup taken while it runs, the write rate limit, and a 503 from `/v1/health` after an audit entry is edited |
| `npm run check:agent` | The shipment rules match the page. The option verifier is strict. Kits and slots held by another plan are not offered again. The six MCP servers start, and only the draft inbox can write. Scripted runs end as expected. The portfolio run promises nothing twice. Approvals are re-checked on the server. The live loop works with a stand-in for the AI |
| `npm run check:ai` | Fetches the official UK sources, then shows, with a stand-in for the AI, that RegChain's checks catch a made-up quote, a wrong effective date, a translated Spanish quote and an edit to a specification line that does not exist |
| `npm run check:offline` | Every check above except `check:ai` |
| `npm run check` | Every check above |

For the OQ, run the checks on the commit being installed and keep their output as evidence. Add manual tests for what they do not cover: the reverse proxy and TLS, the Host check behind the proxy, a restore from backup, and behaviour in the company's browsers.

### Performance qualification (PQ)

Run the journeys in [RegChain-AI-User-Journeys.md](RegChain-AI-User-Journeys.md) (J1 to J11) in password mode: the real people who hold each role, signed in with their own accounts, on the company's data or a representative copy, against acceptance criteria written beforehand. The journeys are written for the demo data and the **Acting as** menu, so they need adapting to named sign-in and real data first.

## 21 CFR Part 11 and EU GMP Annex 11

**In place:** RegChain does this today. **Partly:** some of it, with the gap named. **Not yet:** missing.

| Clause | What RegChain does today | Status |
|---|---|---|
| Validation: 11.10(a), Annex 11 §4 | Automated checks and CI as listed above. No validation has been executed. | Partly |
| Accurate and complete copies: 11.10(b), Annex 11 §8 | Cases, decisions, the audit trail, events, evidence and requirement history can be read through `/v1` as JSON, described at `/v1/openapi.json`. Agent runs can be exported as JSON. There is no printable or PDF record. | Partly |
| Record protection and retention: 11.10(c), Annex 11 §7.1 | Records are in one SQLite database; the audit trail is append-only. AI results and agent runs are files in the cache folder, outside the hash chain. RegChain sets no retention periods, archiving or encryption at rest. | Partly |
| Backups: Annex 11 §7.2 | `npm run backup` copies the database while RegChain runs, verifies the copy's audit chain and copies the cache. `check:security` tests it. A schedule, off-site copies, retention and a restore drill are not set up. | Partly |
| Limiting access: 11.10(d), Annex 11 §12.1 | Named accounts. Passwords of at least 12 characters, stored as salted scrypt hashes. Lockout per username and per client address. Idle and maximum session length. HttpOnly, SameSite=Strict session cookie, Secure over HTTPS. No single sign-on and no second factor. | In place |
| Audit trail: 11.10(e), Annex 11 §9 | Computer-generated entries for every workflow step, approval, sign-in, sign-out and user change, with the person's name, role, the server time (UTC) and the rationale for decisions. Database triggers refuse updates and deletes, and each entry's hash covers the one before. `/v1/audit/verify` and `/v1/health` recompute the chain. A rehearsal reset marks versions withdrawn and never deletes them. Missing: a procedure for regular audit trail review, and keeping the chain's latest hash outside the server, because someone with direct file access could rewrite the whole chain. | Partly |
| Sequence checks: 11.10(f) | The server enforces the workflow order. A decision names the exact proposal revision, and a stale one gets 409. The Quality task goes acknowledge, evidence, verify. A case cannot close while a shipment it covers is blocked with nothing recorded. A failed AI check blocks approval, and approving without an AI check needs a recorded override. Agent plans are re-checked against the rules when approved. An `Idempotency-Key` stops a retry from applying twice. | In place |
| Authority checks: 11.10(g), Annex 11 §12 | The role comes from the account and is checked on the server for each step. Each account has one role. Only Clinical Supply runs the agents, approves or withdraws plans and records shipment actions; only the Regulatory SME runs the AI check and decides on changes. Verification is refused when the verifier's name matches the approver's or the owner's. That they are different people still rests on separate accounts: RegChain cannot detect one person with two accounts. | Partly |
| Input and accuracy checks: Annex 11 §5, §6 | Request bodies are validated against schemas (422 on error) and size-limited. AI quotes and dates are checked against the stored official text. Evidence passages are stored with offsets and hashes, and source versions with SHA-256 hashes. | In place |
| Change and configuration management: Annex 11 §10, 11.10(k) | Code, prompts, model IDs and documents are versioned in git. Numbered migrations are never edited. CI runs the checks on every pull request. There is no formal change control or document control process. | Partly |
| Electronic signatures: 11.50, 11.70, 11.100, 11.200, 11.300, Annex 11 §14 | Decisions record the person's name, role, time and rationale. There is no signature manifestation (printed name, date and time, and meaning shown with the record), no re-authentication when signing, and no link that binds a signature to its record. RegChain approvals are not electronic signatures. | Not yet |
| Incident management: Annex 11 §13 | Request IDs, structured logs and a health route that answers 503 when the audit chain is broken. No alerting and no incident process. | Partly |
| Periodic review: Annex 11 §11 | None defined. | Not yet |
| Business continuity: Annex 11 §16 | One instance with automatic restart, backups and documented restore steps. Recorded results and scripted agent runs work without internet or AI. No continuity plan, second instance or failover. | Partly |
| Archiving: Annex 11 §17 | None. | Not yet |
| Training and accountability: 11.10(i), 11.10(j) | Company procedures, outside the software. | Not yet |
| Risk management and suppliers: Annex 11 §1, §3 | This outline suggests a starting risk table. No risk assessment or supplier agreement exists. | Not yet |

## AI in RegChain

The design keeps the AI output as a draft:

1. **The AI drafts.** Claude drafts the regulatory change from the official text (UK), or from the note and the current specification (Spain). Agents propose options for a blocked shipment and draft the changes each option needs.
2. **Deterministic checks verify.** Before anyone can approve, RegChain checks the draft: every quote must appear word for word in the source it cites, the effective date must match the recorded rule, the change status must agree with the text comparison, and for Spain each edit must replace a line the specification has. Agent options are checked against fixed shipment rules, and checked again on the server when someone approves. A draft or option that fails cannot be approved.
3. **A qualified person decides.** The Regulatory SME approves, edits or rejects the change and gives a rationale. Clinical Supply approves a supply plan. Each draft for IRT, ERP, the depot or the QMS is still approved in that system.

The draft EU GMP Annex 22 on artificial intelligence, published for public consultation in 2025, proposes that generative AI and large language models are not used in critical GMP applications, and that their output in non-critical applications is reviewed by a qualified person. The final text may differ. RegChain's design, where AI output stays a draft that people review and decide on, is in line with that proposal. Whether a given use is critical, and which controls it needs, is for the company's own risk assessment.

What validation of the AI parts should cover:

- The model IDs are pinned in code (`claude-opus-5-5` for the AI check and the orchestrator, `claude-sonnet-5-5` for the specialist agents), and the prompts are versioned in git. The Claude service (`REGCHAIN_AI_PROVIDER`) and any model name set for it (`REGCHAIN_MODEL_*`) are configuration items, and only Claude models are accepted. Changing the service, a model or a prompt is a change to the system: run `check:ai` and `check:agent` again, then a live AI check and a live agent run on the chosen service, and record the result.
- On the services Anthropic runs (`anthropic`, `aws`, `google-cloud`), the AI check allows the provider's server-side fallback (`fallbacks: "default"` in `regchain-ai/analyze.mjs`), so another model may answer when the pinned one is unavailable. Each result records the model that answered. Decide whether to keep the fallback for validated use. Bedrock, Vertex AI and Foundry have no server-side fallback, so there the pinned model answers or the check stops.
- Live AI answers vary between runs. Validate the deterministic checks and the human review with fixed test cases, as the stand-in clients in `check:ai` and `check:agent` do, rather than the wording of a live answer.
- Review, at intervals, the cases where people rejected or edited the AI draft or chose an option other than the recommended one.

## Commercial readiness checklist

### Done in this repository

- Named users with scrypt-hashed passwords, a 12-character minimum, lockout per username and per address, and idle and maximum session length.
- One role per account, checked on the server for every step; same-site checks, schema validation, size limits and a write rate limit.
- A Content Security Policy with a fresh script nonce per page, and the other security headers.
- A SQLite system of record with numbered migrations that run on start.
- An append-only, hash-chained audit trail that covers workflow steps, approvals, sign-ins and user changes, with a verify route.
- An event outbox with at-least-once delivery to a mock QMS, and `Idempotency-Key` support.
- Backups taken while RegChain runs, verified by recomputing the audit chain, with restore steps.
- A Docker image that runs as a non-root user, with a health check; a Compose file; CI that runs the offline checks on every push to `main` and every pull request.
- Structured logs with request IDs, and a health route with the schema version and the audit chain check.
- AI drafts and agent options gated by deterministic checks; agents limited to read tools and a draft inbox; no API key in the MCP server processes.
- Deployment and security documentation, and this outline.

### Still needed from the company

- Single sign-on (OIDC or SAML, for example Microsoft Entra ID), with roles mapped from groups.
- Electronic signatures with re-authentication (Part 11 subpart C, Annex 11 §14).
- Hosting and data residency decisions, including time synchronisation on the server.
- PostgreSQL if more than one instance is needed. SQLite suits one instance, and the rate limits are kept in memory per instance.
- A penetration test.
- A data processing agreement and retention terms with the AI provider, and a decision on the server-side fallback.
- Real integrations to replace the mock QMS, IRT, ERP, depot and eTMF systems.
- Backup retention, off-site copies and a restore drill.
- Monitoring and alerting, including on the health route's 503.
- An accessibility audit against WCAG 2.2 AA.
- A licence for the code. The repository has none today.
- Executing the validation: risk assessment, requirements, protocols, traceability, report, SOPs and training.
