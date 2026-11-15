# RegChain AI · Deployment

*15 November 2026. How to run RegChain for a team: the two modes, every setting, Docker, a reverse proxy, users and roles, backups, upgrades, health and logs, and what goes to the AI provider. Every setting, route and command here is taken from the code in this repository.*

## Two modes

| | Local (`REGCHAIN_AUTH=local`, the default) | Password (`REGCHAIN_AUTH=password`) |
|---|---|---|
| For | One person on their own computer: evaluation, demos, rehearsals | A team on a shared server |
| Who acts | Whoever uses the computer picks a role in the **Acting as** menu | Named users sign in. The role comes from their account |
| Names in the audit trail | The demo case's named person for the chosen role | The signed-in person and their role |
| Network | `127.0.0.1` or `localhost` only. RegChain refuses to start on any other address | Any address, behind an HTTPS reverse proxy |
| Sessions | Do not expire | End after an idle time and a maximum length |
| Rehearsal reset (`?fresh`) | Allowed | Refused with 403 |

Records made in local mode do not name a real person. Use password mode for anything you intend to keep.

In local mode, `node serve-regchain.cjs` starts RegChain at `http://127.0.0.1:4173/`. On Windows, `npm start` or **Start-ClinRadar.cmd** also opens the browser.

In password mode:

- The dashboard and its data are served only after sign-in. Before that, `/` shows the sign-in page. The public launch page at `/site/` (`sites/clinradar/`) is served before and after sign-in.
- Every `/api` route and every `/v1` route needs a signed-in user, except `GET /v1/health`, `GET /v1/session`, `POST /v1/auth/login`, `GET /v1/openapi.json` and the launch page's contact form, `POST /api/contact` (same-site JSON, validated, at most `REGCHAIN_CONTACTS_PER_HOUR` per client address, stored as one line in `<data dir>/contact-requests.jsonl` without the client address). Other requests get 401.
- `POST /v1/session`, the role switch, answers 403. A person cannot change role.

## Settings

All settings are environment variables. An unset variable uses the default.

| Variable | Default | What it does |
|---|---|---|
| `REGCHAIN_AUTH` | `local` | `password` turns on named users. Any other value means local mode |
| `REGCHAIN_HOST` | `127.0.0.1` | Address to listen on. The Docker image sets `0.0.0.0` |
| `REGCHAIN_PORT` | `4173` | Port to listen on |
| `REGCHAIN_PUBLIC_ORIGIN` | none | The address people open, for example `https://regchain.your-company.example`. Its host is accepted in the `Host` header and as a same-site `Origin`. An `https://` address turns on the `Secure` cookie flag and HSTS |
| `REGCHAIN_TRUST_PROXY` | off | Takes the client address from the first entry of `X-Forwarded-For` |
| `REGCHAIN_SESSION_IDLE_MINUTES` | `480` | Password mode: a session ends after this long without a request |
| `REGCHAIN_SESSION_MAX_HOURS` | `12` | Password mode: a session ends after this long, however active. Also the cookie's `Max-Age` |
| `REGCHAIN_LOGIN_ATTEMPTS` | `5` | Failed sign-ins for one username within the lock window before it is locked |
| `REGCHAIN_LOGIN_ATTEMPTS_PER_ADDRESS` | `20` | Failed sign-ins from one client address, across usernames, before it is locked |
| `REGCHAIN_LOGIN_LOCK_MINUTES` | `15` | The window in which failures are counted, so a lock lasts at most this long |
| `REGCHAIN_WRITES_PER_MINUTE` | `120` | Per client address per minute: write requests to `/v1`, and separately requests to `/api` that start work. Over the limit: 429 with `Retry-After` |
| `REGCHAIN_CONTACTS_PER_HOUR` | `10` | Per client address per hour: messages sent through the public contact form (`POST /api/contact`). Over the limit: 429 with `Retry-After` |
| `REGCHAIN_ENTERPRISE_TOKEN` | none | Password mode: the bearer token the enterprise risk system sends to `POST /api/enterprise-alerts`. While it is unset the webhook answers 503. In local mode only this computer may post alerts. Use a long random value and keep it in the secret store |
| `REGCHAIN_SCHEDULER` | on | `off` stops the server's own checks: no scheduled check, no feed poll, no regulatory poll. Checks then run only from the page. For tests and for a copy that must never reach the internet. See [Alerts and the schedule](#alerts-and-the-schedule) |
| `REGCHAIN_ALERT_EMAIL_TO` | none | Who receives the alerts by email: Clinical Supply's addresses, separated by commas |
| `REGCHAIN_SMTP_HOST`, `REGCHAIN_SMTP_PORT` | none, `587` (`465` with `tls`) | The company's mail server |
| `REGCHAIN_SMTP_SECURITY` | `starttls` | `starttls` (required, not optional), `tls` (encrypted from the start, usually port 465), or `none`, which only works with a relay on this computer (`127.0.0.1`) |
| `REGCHAIN_SMTP_USER`, `REGCHAIN_SMTP_PASSWORD` | none | The sign-in, if the mail server asks for one (PLAIN or LOGIN). Never sent without encryption. Keep the password in the secret store |
| `REGCHAIN_SMTP_FROM` | none | The sender address, for example `clinradar@your-company.example` |
| `REGCHAIN_ALERT_WEBHOOK_URL` | none | A chat webhook that receives the alerts. `https://` only (or `http://127.0.0.1` for a test) |
| `REGCHAIN_ALERT_WEBHOOK_FORMAT` | `json` | `teams` (an Adaptive Card for a Teams workflow, "When a Teams webhook request is received"), `slack` (an incoming webhook) or `json` (the alerts as data, for any other system) |
| `REGCHAIN_LOG_FORMAT` | `json` | `text` gives lines for reading in a terminal |
| `REGCHAIN_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `REGCHAIN_DATA_DIR` | `.regchain-data` in the RegChain folder | Folder of the database. The Docker image sets `/data` |
| `REGCHAIN_DB` | `REGCHAIN_DATA_DIR/regchain.db` | The database file itself |
| `REGCHAIN_CACHE_DIR` | `.regchain-cache` in the RegChain folder | Official text copies, AI results and agent runs. The Docker image sets `/data/cache` |
| `REGCHAIN_TENANT` | `default` | The `tenant_id` written on outbox events |
| `REGCHAIN_ALLOW_LOCAL_AUTH_ON_NETWORK` | off | Lets local mode listen on a network address. Anyone who reaches it can act as any role. Not for a team |
| `REGCHAIN_NEW_PASSWORD` | none | Read by `scripts/users.mjs` only: the password to set instead of a generated one |
| `REGCHAIN_AI_PROVIDER` | `anthropic` | Which Claude service RegChain calls: `anthropic`, `aws`, `bedrock`, `google-cloud`, `vertex` or `foundry`. See [Which Claude service](#which-claude-service) |
| `ANTHROPIC_API_KEY` | none | With `anthropic`: turns on the live AI check and live agent runs. `ANTHROPIC_AUTH_TOKEN` is also accepted |
| `REGCHAIN_MODEL_ORCHESTRATOR`, `REGCHAIN_MODEL_SPECIALIST`, `REGCHAIN_MODEL_WATCH`, `REGCHAIN_MODEL_AI_CHECK` | the service's names for Claude Opus 5.5, Claude Sonnet 5.5, Claude Haiku 5.5 and Claude Opus 5.5 | The model for the master agent, the specialist agents, the watch team and the AI check. Claude models only |

Switches accept `1`, `true`, `yes` or `on`. A number that is empty or not a number falls back to its default.

**Where to set them.** In the environment of the process (in `docker-compose.yml` or your process manager), or in a `.env` file next to `serve-regchain.cjs`. The server, `scripts/users.mjs` and `scripts/backup.mjs` all read that file before anything else, so they use the same settings and open the same database. A variable already set in the environment wins over the file. Make `.env` readable only by the account that runs RegChain, because it can hold the API key.

## Which Claude service

RegChain uses Claude models only. `REGCHAIN_AI_PROVIDER` chooses how it reaches them: through Anthropic directly, or through the cloud the company already uses, so the AI requests stay under the company's existing cloud agreement, account and region. The agents, prompts, rules and checks are the same on every service.

| `REGCHAIN_AI_PROVIDER` | Service | Package to install | What to set | Model names |
|---|---|---|---|---|
| `anthropic` (default) | Claude API, run by Anthropic | None, it is included | `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) | `claude-opus-5-5`, `claude-sonnet-5-5` |
| `aws` | Claude Platform on AWS: run by Anthropic, reached and billed through AWS | `@anthropic-ai/aws-sdk` | `AWS_REGION`, `ANTHROPIC_AWS_WORKSPACE_ID`, AWS credentials | The same as Anthropic's |
| `bedrock` | Amazon Bedrock, run by AWS | `@anthropic-ai/bedrock-sdk` | `AWS_REGION`, AWS credentials (or `AWS_BEARER_TOKEN_BEDROCK`). Turn on access to the two models in the AWS console first | `anthropic.claude-opus-5-5`, `anthropic.claude-sonnet-5-5` |
| `google-cloud` | Claude on Google Cloud (Anthropic managed): run by Anthropic, reached and billed through Google Cloud | `@anthropic-ai/google-cloud-sdk` | `ANTHROPIC_GOOGLE_CLOUD_WORKSPACE_ID`, the project (`ANTHROPIC_GOOGLE_CLOUD_PROJECT`, or the one in the Google credentials), Google credentials | The same as Anthropic's |
| `vertex` | Google Cloud Vertex AI, run by Google | `@anthropic-ai/vertex-sdk` | `CLOUD_ML_REGION` (`global`, or `us` or `eu`; regional endpoints do not serve these models), `ANTHROPIC_VERTEX_PROJECT_ID` (or the project in the Google credentials), Google credentials | The same as Anthropic's |
| `foundry` | Microsoft Foundry, on Azure | `@anthropic-ai/foundry-sdk`, and `@azure/identity` for Microsoft Entra ID | `ANTHROPIC_FOUNDRY_RESOURCE` (or `ANTHROPIC_FOUNDRY_BASE_URL`), and `ANTHROPIC_FOUNDRY_API_KEY` or Microsoft Entra ID | The deployment names, which by default are Anthropic's model names |

**Credentials.**

- AWS (`aws`, `bedrock`): the usual AWS chain, so an IAM role on the server, a profile, or `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The identity needs access to Claude in that account.
- Google (`google-cloud`, `vertex`): Application Default Credentials, so the service account attached to the server, `GOOGLE_APPLICATION_CREDENTIALS`, or `gcloud auth application-default login` on a workstation. When none is found, a live AI run stops with that message and the rest of RegChain keeps working.
- Azure (`foundry`): `ANTHROPIC_FOUNDRY_API_KEY`, or without it Microsoft Entra ID through a managed identity, a service principal or `az login`.

**Installing the package.** In a folder install, run `npm install` with the package name in the RegChain folder. With Docker, build with it: `docker compose build --build-arg REGCHAIN_AI_PACKAGES=@anthropic-ai/bedrock-sdk` (several packages go in quotes, separated by spaces), and add the service's settings to `docker-compose.yml`. The cloud packages are not in `package.json`, so an install that uses Anthropic's API carries no cloud libraries.

**Model names.** `REGCHAIN_MODEL_ORCHESTRATOR`, `REGCHAIN_MODEL_SPECIALIST`, `REGCHAIN_MODEL_WATCH` and `REGCHAIN_MODEL_AI_CHECK` replace the names in the table, for example for a Foundry deployment with its own name. Only Claude models are accepted: a name without "claude" turns live AI off with a message.

**One difference between services.** On the services Anthropic runs (`anthropic`, `aws`, `google-cloud`), the AI check asks for Anthropic's server-side fallback, so another Claude model can answer if the chosen one declines. Bedrock, Vertex AI and Foundry do not offer it: there a refusal ends the check with a message, and the expert runs it again or decides without it. Everything else RegChain uses (streaming, tool use, adaptive thinking, structured outputs) works on all six.

**Checking it.** At start, RegChain prints the Claude service and whether it is ready, or the one setting that is missing. The page shows the same sentence where the AI check and the agents are started.

Changing the service or a model is a change to the validated system (see [RegChain-AI-Validation.md](RegChain-AI-Validation.md)): run `npm run check:ai`, a live AI check and a live agent run on the new service before people rely on it.

## Run with Docker Compose

The image (`Dockerfile`):

- starts from `node:24-bookworm-slim` and installs only the production dependencies with `npm ci --omit=dev`;
- runs as the unprivileged `node` user;
- sets `REGCHAIN_AUTH=password`, `REGCHAIN_HOST=0.0.0.0`, `REGCHAIN_PORT=4173`, `REGCHAIN_DATA_DIR=/data` and `REGCHAIN_CACHE_DIR=/data/cache`;
- keeps all data in the `/data` volume;
- has a health check that calls `/v1/health` every 30 seconds on the configured port and passes only on HTTP 200, which needs an intact audit chain.

`docker-compose.yml` runs one instance. It publishes port 4173 on `127.0.0.1` only, keeps `/data` in the named volume `regchain-data`, restarts unless stopped, and passes `REGCHAIN_AI_PROVIDER` and `ANTHROPIC_API_KEY` from your shell or from a `.env` file next to `docker-compose.yml`. `.dockerignore` keeps `.env`, the local database and the cache out of the image.

1. In `docker-compose.yml`, uncomment `REGCHAIN_PUBLIC_ORIGIN` and `REGCHAIN_TRUST_PROXY` and set the address (see the next section).
2. For the live AI check and live agent runs, put `ANTHROPIC_API_KEY=` and your key in `.env` next to `docker-compose.yml`. To reach Claude through AWS, Google Cloud or Azure instead, follow [Which Claude service](#which-claude-service). Without AI, recorded results and scripted agent runs still work.
3. Build and start:
   ```sh
   docker compose build
   docker compose up -d
   ```
4. Create one account per person (see [Users and roles](#users-and-roles)). Each command prints a generated password once:
   ```sh
   docker compose exec regchain node scripts/users.mjs add sam.supply "Sam Supply" viewer
   docker compose exec regchain node scripts/users.mjs add rita.reg "Rita Regulatory" reviewer
   docker compose exec regchain node scripts/users.mjs add olga.owner "Olga Owner" owner
   docker compose exec regchain node scripts/users.mjs add vic.verify "Vic Verifier" verifier
   ```
5. Check it answers: `curl -s http://127.0.0.1:4173/v1/health`.

On first start, RegChain creates the database, runs the migrations, creates the cases and replays both fixture sets with the recorded extraction. A new volume has an empty cache, so this first replay fetches the UK official texts once from legislation.gov.uk and GOV.UK. It makes no AI call. Allow outbound HTTPS to `www.legislation.gov.uk` and `www.gov.uk`, and to the Claude service if you use the live AI check or live agents: `api.anthropic.com` for Anthropic's API, or the cloud service's endpoint in your region.

## HTTPS reverse proxy

RegChain serves plain HTTP. Put an HTTPS reverse proxy in front of it. A Caddy example, on the same server as the Compose stack:

```caddyfile
regchain.your-company.example {
    reverse_proxy 127.0.0.1:4173
}
```

Caddy obtains and renews the certificate and passes the original `Host` header. Then set, in `docker-compose.yml`:

```yaml
    environment:
      REGCHAIN_PUBLIC_ORIGIN: "https://regchain.your-company.example"
      REGCHAIN_TRUST_PROXY: "1"
```

What these two settings change:

- **Host check.** RegChain answers only when the `Host` header is `127.0.0.1:<port>`, `localhost:<port>` or the host of `REGCHAIN_PUBLIC_ORIGIN`. Anything else gets 400. A proxy must pass the public host through (in nginx: `proxy_set_header Host $host;`).
- **Same-site checks.** Writes that carry an `Origin` other than these addresses get 403.
- **HTTPS.** With an `https://` public origin, the session cookie gets the `Secure` flag and pages send `Strict-Transport-Security`.
- **Client address.** With `REGCHAIN_TRUST_PROXY`, RegChain uses the first address in `X-Forwarded-For` for the lockout per address, the write rate limit, the request logs and the audit of sign-ins. Turn it on only when RegChain can be reached through the proxy alone and the proxy writes that header itself. Caddy replaces the header by default; in nginx use `proxy_set_header X-Forwarded-For $remote_addr;`. Without it, every user appears to come from the proxy, so all of them share one lockout counter per address and one write limit.

## Run without Docker

1. Install Node.js 22.13 or later (`package.json` requires it; the image and CI use Node 24).
2. Copy the repository to the server, for example to `/opt/regchain`, and install the production dependencies:
   ```sh
   cd /opt/regchain && npm ci --omit=dev
   ```
3. Create a `regchain` user and a data folder it owns, for example `/var/lib/regchain`.
4. Put the settings in an environment file, for example `/etc/regchain/regchain.env`, readable only by the `regchain` user because it can hold the AI credentials:
   ```sh
   REGCHAIN_AUTH=password
   REGCHAIN_HOST=127.0.0.1
   REGCHAIN_PORT=4173
   REGCHAIN_PUBLIC_ORIGIN=https://regchain.your-company.example
   REGCHAIN_TRUST_PROXY=1
   REGCHAIN_DATA_DIR=/var/lib/regchain
   REGCHAIN_CACHE_DIR=/var/lib/regchain/cache
   ANTHROPIC_API_KEY=your-key
   ```
   Keep `REGCHAIN_HOST=127.0.0.1` when the proxy runs on the same server.
5. Start it with `node serve-regchain.cjs` under a process manager that restarts it. (`npm start` adds `--open`, which only opens a browser in local mode on Windows.) A systemd example:
   ```ini
   [Unit]
   Description=RegChain AI
   After=network.target

   [Service]
   User=regchain
   WorkingDirectory=/opt/regchain
   EnvironmentFile=/etc/regchain/regchain.env
   ExecStart=/usr/bin/node serve-regchain.cjs
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```
6. Run the users and backup scripts as the same user, from the same folder, with the same settings. Otherwise they open a different database:
   ```sh
   sudo -u regchain sh -c 'set -a; . /etc/regchain/regchain.env; cd /opt/regchain && node scripts/users.mjs list'
   ```

## Users and roles

Each person has one account, and each account has exactly one role.

| Role id | Role | What the server lets only this role do |
|---|---|---|
| `viewer` | Clinical Supply | Run the agents. Approve or withdraw an agent plan. Record or clear a manual shipment action |
| `reviewer` | Regulatory SME | Run the AI check. Approve, edit and approve, reject, investigate, defer or resume a regulatory change. Record a decision on a change without a case. Start a case again |
| `owner` | Quality owner | Acknowledge the Quality task and submit the evidence |
| `verifier` | Quality verifier | Return or verify the evidence and close the case. Start a case again |

Every signed-in role can read everything. Any other role that calls one of these routes gets 403 with the name of the role that may.

**Why one role per person.** Segregation of duties: the Regulatory SME who approves a change, the Quality owner who implements it and the Quality verifier who closes it must be different people. RegChain enforces this through accounts, because an account cannot switch role, and it refuses verification when the verifier's name matches the approver's or the owner's. It cannot tell whether one person holds two accounts under different names, so never give one person a second account with another role.

| Command | What it does |
|---|---|
| `node scripts/users.mjs add <username> "<Full name>" <role>` | Creates the account and prints a generated password once |
| `node scripts/users.mjs list` | Lists accounts with role, active flag, creation time and last sign-in |
| `node scripts/users.mjs password <username>` | Sets a new password, prints it once, and ends that person's sessions |
| `node scripts/users.mjs role <username> <role>` | Changes the role and ends that person's sessions |
| `node scripts/users.mjs disable <username>` | Blocks sign-in and ends that person's sessions |
| `node scripts/users.mjs enable <username>` | Allows sign-in again |

In Docker, put `docker compose exec regchain` in front. `npm run users -- <command>` does the same as `node scripts/users.mjs`.

- Usernames have 3 to 40 letters, digits, dots, dashes or underscores, and are unique regardless of case. The full name is what the audit trail shows.
- Passwords need at least 12 characters. To set a chosen password instead of a generated one, run the command with `REGCHAIN_NEW_PASSWORD` set. Hand passwords over through a private channel.
- Every user change is in the audit trail with the actor `RegChain administrator (<account>)`, where the account is the operating-system user that ran the command. Give each administrator their own server account, and limit shell access to them.
- Accounts are disabled, never deleted, so their history stays readable. A role change is audited with the old and the new role.
- People cannot change their own password yet. An administrator sets a new one.

## Backups and restore

`npm run backup` (`node scripts/backup.mjs [target folder]`, default: a `backups` folder inside the data folder, `/data/backups` in Docker) works while RegChain runs:

1. It writes a consistent copy of the database with SQLite `VACUUM INTO`, as `regchain-<timestamp>.db`.
2. It opens the copy read-only and recomputes its audit chain. If the chain is broken, it stops with exit code 1: keep the original and investigate.
3. It copies the cache folder as `cache-<timestamp>`.

In Docker, the default folder is inside the volume. Copy the backups off the server afterwards:

```sh
docker compose exec regchain node scripts/backup.mjs
docker compose cp regchain:/data/backups ./regchain-backups
```

Run it daily, for example from cron (use `docker compose exec -T` there), and keep copies off the server. The script never deletes old backups, so set a retention period and remove old copies by that rule. Practise a restore before you rely on it.

To restore:

1. Stop RegChain.
2. Copy the chosen `regchain-<timestamp>.db` to the database path: `REGCHAIN_DB`, or `REGCHAIN_DATA_DIR/regchain.db` (`/data/regchain.db` in Docker). Delete `regchain.db-wal` and `regchain.db-shm` next to it if they exist: they belong to the replaced database.
3. Replace the contents of `REGCHAIN_CACHE_DIR` with the matching `cache-<timestamp>` folder.
4. Start RegChain and open `/v1/health`. It must answer 200 with `"status": "ok"`.

In Docker, steps 2 and 3 run in a one-off container on the same volume. This restores a backup that is still in `/data/backups`; for a copy kept elsewhere, mount its folder with `-v` and copy from there:

```sh
docker compose stop regchain
docker compose run --rm regchain sh -c 'cp /data/backups/regchain-<timestamp>.db /data/regchain.db && rm -f /data/regchain.db-wal /data/regchain.db-shm && rm -rf /data/cache && cp -r /data/backups/cache-<timestamp> /data/cache'
docker compose start regchain
```

## Upgrades and migrations

1. Back up first.
2. Keep the current image so you can go back, for example `docker tag <project>-regchain regchain:previous` (`docker compose images` shows the name).
3. Get the new code and start it: `docker compose build && docker compose up -d`, or `npm ci --omit=dev` and restart the service.
4. Migrations run on start. Each numbered migration runs once, in order, inside a transaction, and is recorded in the `schema_migration` table. A migration that has shipped is never edited: changes come as new migrations.
5. Open `/v1/health`: it must answer 200, with `schema_version` 3 in this version (migration 3 adds the alerts and their deliveries).

There are no down migrations. To roll back, stop RegChain, start the previous image or code, and restore the backup from step 1.

Earlier versions kept agent plan approvals in `agent-approvals.json` in the cache folder. The first time the new version reads approvals, it imports them into the database, each with an `approval.imported` audit entry, and renames the file to `agent-approvals.imported-<number>.json` so it is kept but never read again.

## Health and logs

`GET /v1/health` needs no sign-in. It recomputes the whole audit hash chain and answers, for example:

```json
{ "status": "ok", "schema_version": 3, "audit": { "ok": true }, "time": "2026-11-15T09:00:00.000Z" }
```

- A broken chain is an incident: the route answers **503** with `"status": "audit_chain_broken"`, so any monitor that checks the HTTP status raises it. The Docker health check does.
- Before sign-in, in password mode, `audit` shows only `ok`. Signed in, or in local mode, it also shows the number of entries, the latest hash and, when broken, `brokenAt`.
- The check reads every audit entry, so it gets slower as the trail grows.

- Each request is logged as one line, JSON by default, on standard output: `time`, `level`, `message`, `request_id`, `method`, `path`, `status`, `ms` and `address`. Calls to `/v1/health` are not logged.
- Warnings and errors go to standard error. A server error on `/v1` is logged with its method, path, request ID and stack trace, and the caller gets a generic message.
- Some messages are plain text, not JSON: start-up lines and failures of AI checks and agent runs.
- `REGCHAIN_LOG_FORMAT=text` gives readable lines. `REGCHAIN_LOG_LEVEL=warn` leaves out the request lines.
- Every response carries `X-Request-Id`. A caller's own `X-Request-Id` of 8 to 80 letters, digits, dots, dashes or underscores is kept; otherwise RegChain creates one. Search the logs for it to trace a request.
- In Docker: `docker compose logs -f regchain`.

## Alerts and the schedule

**The server runs the checks.** Nobody has to keep the page open. On the monitoring schedule (Settings › Monitoring schedule, Athens time) the server runs the full check: it reads the official regulatory sources again, reads the live feeds (UK FCDO travel advice and GDACS) for every country monitored for external risk, matches every signal to the shipments and raises the alerts. Between full checks it polls the feeds every `weather_poll_minutes` (30) and reads the regulatory sources again every `regulatory_poll_hours` (24), both from `config/supplyshield.yaml`; a poll that finds something new raises its alerts at once. A check missed while the server was down runs once when it starts again. Pausing the schedule pauses all of it. When Settings say "Have the agents prepare plans", the agents plan every blocked shipment without a plan after a scheduled check: live with Claude when it is set up, otherwise the scripted walkthrough. Their plans are drafts, and Clinical Supply approves them. Each run is one `supplyshield.checked` audit entry with what it read and found; the regulatory read is a `regulatory_sources.checked` entry. A source that does not answer keeps its last good copy, and the entry says so. `GET /api/scheduler` gives the last and next runs. The start-up lines say when the next check is due.

**Alerts go to Clinical Supply.** After every check and poll, ClinRadar raises an alert for each new item that touches our shipments: a confirmed disruption, a potential exposure, a rule change that holds planned shipments, or an import approval that no longer covers a shipment. An item is raised once. The same match at a higher tier, potential and then confirmed, is a new alert. Each alert carries its evidence: the event, the shipment and the leg, the record that confirmed it (or what is missing and who must confirm it), the patients behind it, the sources with their times, the next step and a link that opens the signal. Patients appear only as a count: ClinRadar holds no patient-level data. All the alerts of one run go out together, as one email and one webhook message, most urgent first. A confirmed disruption is CRITICAL when patients would go without treatment or the site has 7 days of stock or less.

- **Email:** set `REGCHAIN_ALERT_EMAIL_TO`, `REGCHAIN_SMTP_HOST`, `REGCHAIN_SMTP_FROM` and, if the mail server asks for a sign-in, `REGCHAIN_SMTP_USER` and `REGCHAIN_SMTP_PASSWORD`. RegChain speaks SMTP itself, with no extra package: STARTTLS on 587 by default, or TLS on 465. It refuses to send a password without encryption.
- **Chat:** set `REGCHAIN_ALERT_WEBHOOK_URL` and `REGCHAIN_ALERT_WEBHOOK_FORMAT`. For Microsoft Teams, create a workflow from the template "Post to a channel when a webhook request is received" and use its address with `teams`. For Slack, create an incoming webhook and use `slack`.
- **No channel set up:** alerts are still raised, audited and shown in ClinRadar (Overview, and Settings › Alerts); the start-up lines say that none is sent.
- **Delivery:** a message that could not be delivered is tried again at the next check or poll, up to five times, then marked failed. Every alert (`alert.raised`), every delivery (`alert.delivered`) and every failure (`alert.delivery_failed`) is in the audit trail. Settings › Alerts shows each channel, what it still needs, the latest alerts and what happened to each delivery, and **Send a test alert** (Clinical Supply or the Quality owner).
- **Rehearsals:** `?fresh` and `?empty` archive the open alerts (they stay in the database and the trail), so the next check of the rehearsal raises them again.

The SMTP password and the webhook address stay on the server. The page learns only the recipients, the mail server's name and the webhook's host.

## AI and the data it receives

RegChain calls the configured Claude service only for the live AI check and live agent runs, and only once that service is set up (see [Which Claude service](#which-claude-service)). Recorded results and scripted agent runs make no AI call.

What each call sends:

- **UK AI check:** the official public texts fetched at run time (regulation 46 before and after 28 April 2026, Schedule 14 paragraph 6, and the MHRA guidance section) and the task, which names the company requirement key being drafted, `GB/IMP_LABELING`.
- **Spain AI check:** the fictional Spanish note and the current Spain Country Specification. In this repository the specification is fictional too.
- **Live agent runs:** the shipment data the agents read through the MCP servers. In this repository that data is fictional (`demo-data/supply-operations.json`).

Do not put real company specifications or records into AI requests until the company has a data processing agreement and retention terms with the provider that runs the chosen service: Anthropic, or the cloud provider for Bedrock, Vertex AI and Foundry.

The AI credentials stay on the server: the page only learns which service is set and whether it is ready. The eight MCP server processes start with a minimal environment plus the data and cache folder settings, never the API key or the cloud credentials.

AI results and agent runs stay as files in the cache folder (`REGCHAIN_CACHE_DIR`): the last AI check per case (`analysis-latest.json`, `analysis-es-latest.json`), the latest run per shipment (`agent-run-<shipment>.json`), the last portfolio run (`agent-portfolio-run.json`), every saved version of each shipment run under `agent-runs/`, and the cached official texts. Approvals and case decisions are in the database. `npm run backup` copies the cache together with the database.
