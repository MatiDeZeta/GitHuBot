<h1 align="center">
  <a href="https://github.com/MatiDeZeta/GitHuBot">
    <img src="https://i.imgur.com/pREImdE.png" alt="GitHuBot" width="72">
  </a>
  <br>
  GitHuBot
</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="MIT"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.2.1-8b5cf6?style=flat-square" alt="Version"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-22_LTS-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node"></a>
  <a href="https://discord.js.org/"><img src="https://img.shields.io/badge/discord.js-v14-5865F2?style=flat-square&logo=discord&logoColor=white" alt="discord.js"></a>
  <a href="https://pnpm.io/"><img src="https://img.shields.io/badge/pnpm-11-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm"></a>
</p>

<p align="center">
  Beautiful Discord changelog messages for GitHub activity — <strong>without giving the bot any GitHub credentials</strong>.
</p>

> Replaces GitHub’s default Discord webhook spam with branded [Components V2](https://docs.discord.com/developers/components/reference) messages across **48 event types**. You create the webhook yourself; the bot only *receives* and verifies signed deliveries.

> [**ⓘ**](#security) **Security:** there is no `GITHUB_TOKEN` in this project. A compromise of the host cannot leak or misuse GitHub write access, because none exists.

---

## Usage

1. Create a Discord application in the [Developer Portal](https://discord.com/developers/applications) and invite the bot with `applications.commands` + `bot` (Send Messages, View Channels).
2. Deploy GitHuBot (Railway / Docker / local) and set the [environment variables](#environment-variables).
3. Attach a **persistent volume** at `/app/data` if using SQLite (so tracked repos survive redeploys).
4. In Discord, run `/repo add repository:owner/repo channel:#changelog` (requires **Manage Server**).
5. Create the GitHub webhook from the ephemeral instructions (Payload URL + secret), content type `application/json`, **Send me everything**.
6. Run `/repo test owner/repo` to confirm the channel works, then `/repo events owner/repo` to choose what gets posted.

> [**ⓘ**](#slash-commands) Optional: set `DISCORD_ALLOWED_USER_ID` to lock `/repo` commands to a single Discord user ID.

<details>
<summary><strong>More information</strong></summary>

### Why GitHuBot?

GitHub’s built-in Discord integration dumps generic embeds. GitHuBot turns the same webhook stream into a clean changelog: accent colors, author avatars, commit lists, labelled fields and link buttons — with a security model that never asks for a GitHub token.

### Features

1. **Zero GitHub credentials** — per-repo tracking ID + encrypted webhook secret
2. **48 event types** in nine categories, toggled through a two-step picker
3. **Components V2 only** — no legacy embeds
4. **Themes and density** — five palettes, detailed or compact
5. **Filters, routing and mentions** — branch/label/author rules, per-category channels, role pings
6. **Pause, test and health** — operate a repo without touching GitHub
7. **Signature verify + delivery dedupe** — `X-Hub-Signature-256` / `X-GitHub-Delivery`
8. **SQLite by default** — Railway/Docker volume; Postgres via `DATABASE_URL`
9. **Secret rotation** — `/repo regenerate-secret` with graceful cutover
10. **Metrics-driven presence** and a `/stats` command

### Architecture

```mermaid
flowchart LR
  subgraph discord [Discord]
    Slash["/repo commands"]
    Channel[Target channel]
  end
  subgraph app [GitHuBot]
    Bot[discord.js]
    Fastify[Fastify]
    DB[(SQLite / Postgres)]
  end
  subgraph github [GitHub]
    Hook[Repo webhook]
  end
  Slash --> Bot
  Bot --> DB
  Hook -->|"POST /webhooks/github/:trackingId"| Fastify
  Fastify --> DB
  Fastify --> Channel
```

### Delivery pipeline

```mermaid
flowchart TD
    hook["POST /webhooks/github/:trackingId"] --> verify["Verify signature + dedupe delivery"]
    verify --> paused{"Repo paused?"}
    paused -->|yes| skip["200 ignored"]
    paused -->|no| enabled{"Event type enabled?"}
    enabled -->|no| skip
    enabled -->|yes| filters["Apply filters: branch, label, author"]
    filters -->|filtered out| skip
    filters -->|pass| build["Build EventTemplate from payload"]
    build --> render["Render: theme + display mode + locale + icons"]
    render --> route["Resolve target: per-category route or default channel"]
    route --> mentions["Prepend mention line + allowedMentions"]
    mentions --> send["Send message"]
    send --> health["Record delivery health + metrics"]
```

</details>

---

## Slash commands

| Command | Description |
|---|---|
| `/repo add` | Track a repo; ephemeral webhook setup instructions |
| `/repo remove` | Untrack (delete the GitHub webhook manually) |
| `/repo list` | Tracked repos with pause state, routes, filters, last delivery |
| `/repo events` | Two-step category picker with presets |
| `/repo channel` | Change the default destination channel |
| `/repo route` | Send one category to a different channel |
| `/repo mentions` | Ping a role for one category |
| `/repo filters` | Branch / label / author rules (modal) |
| `/repo style` | Theme and display density |
| `/repo pause` · `/repo resume` | Mute without touching GitHub |
| `/repo test` | Post a sample message to verify setup |
| `/repo health` | Delivery counters and the last error |
| `/repo webhook-info` | Re-show Payload URL + secret |
| `/repo regenerate-secret` | Rotate the secret with a grace period |
| `/repo language` | Set this server's language |
| `/help` | Setup, events, filters, appearance, troubleshooting |
| `/stats` | Uptime, counters, latency, busiest repos |
| `/about` · `/ping` | Version info and latency |

Every `repository` option autocompletes from the repos tracked in that server.

---

## Event catalog

Defaults are marked ●. Everything else is opt-in through `/repo events`.

| Category | Events |
|---|---|
| **Code** | `push` ● · `create` ● · `delete` ● · `commit_comment` |
| **Pull requests** | `pull_request` ● · `pull_request_review` · `pull_request_review_comment` · `pull_request_review_thread` |
| **Issues** | `issues` ● · `issue_comment` · `label` · `milestone` · `sub_issues` · `issue_dependencies` |
| **CI/CD** | `workflow_run` · `workflow_job` · `check_run` · `check_suite` · `status` · `deployment` · `deployment_status` |
| **Releases** | `release` ● · `package` · `registry_package` |
| **Discussions** | `discussion` · `discussion_comment` |
| **Security** | `dependabot_alert` · `code_scanning_alert` · `secret_scanning_alert` · `secret_scanning_alert_location` · `repository_advisory` · `repository_ruleset` · `security_and_analysis` · `security_advisory`* · `branch_protection_rule` · `branch_protection_configuration` |
| **Community** | `fork` · `star` · `sponsorship` · `member` · `public` |
| **Repository & meta** | `repository` · `gollum` · `projects_v2_item` · `deploy_key` · `meta` · `page_build` · `custom_property_values` |

Presets in the picker: **Minimal** (`push`, `release`), **Standard** (the six defaults), **Everything**, **Disable all**.

<sub>*`security_advisory` is only ever delivered to GitHub Apps, so a repository webhook never receives it — it is kept for older configurations. `repository_advisory` is the repository-scoped equivalent. ([Availability](https://docs.github.com/en/webhooks/webhook-events-and-payloads))</sub>

Some events are intentionally quiet even when enabled: successful workflow jobs, check runs and check suites are skipped because the workflow-level result already covers them, and `pending` commit statuses never post.

---

## Filters, routing and mentions

**Filters** — `/repo filters owner/repo` opens a modal:

| Field | Behaviour |
|---|---|
| Only these branches | Glob allow-list (`main`, `release/*`). Empty means all. |
| Never these branches | Glob deny-list, evaluated first. |
| Only these labels | Applies only to events that carry labels (issues, PRs and their comments). |
| Ignore these authors | Logins or globs. The literal `bot` drops every bot account. |

Branch rules apply to any event whose payload names a branch: pushes, branch/tag events, pull requests, workflow and check events, deployments and code scanning alerts.

**Routing** — `/repo route owner/repo category:cicd channel:#builds` sends that whole category elsewhere. Text, announcement, thread, forum and media channels all work; forum and media channels get one post per event. Omit `channel` to clear the route.

**Mentions** — `/repo mentions owner/repo category:security role:@secops` prepends a ping line and scopes `allowedMentions` to exactly that role.

---

## Appearance

**Themes** — `/repo style owner/repo theme:<id>`

| Theme | Look |
|---|---|
| `default` | Balanced, saturated accents |
| `github` | Mirrors GitHub's own state colors |
| `neon` | High saturation, tuned for dark themes |
| `mono` | Single neutral grey |
| `language` | Accent from the repository's primary language |

**Density** — `/repo style owner/repo mode:<detailed\|compact>`. Detailed shows avatars, quoted bodies, labelled fields, media galleries and relative timestamps; compact is one line plus link buttons.

**Icons** — every glyph is a Unicode default. Override any of them with custom application emojis:

```
EMOJI_OVERRIDES={"push":"<:push:123456789012345678>","merged":"<:merged:123456789012345678>"}
```

Keys are icon names (`push`, `merged`, `failure`, `star`, `shield`, …). Unknown keys are logged and ignored.

---

## Presence

Discord ignores `assets`, `party`, `timestamps`, `buttons` and `secrets` for **bot** presences — only `name`, `type`, `state` and `url` are honored, so there is no true Rich Presence for bots. GitHuBot instead rotates text driven by live metrics.

```
PRESENCE_ROTATION=[{"type":"watching","name":"{repos} repos"},{"type":"custom","name":"Custom Status","state":"{events} events today"}]
PRESENCE_STREAM_URL=https://twitch.tv/yourchannel
```

Placeholders: `{repos}` `{servers}` `{events}` `{uptime}` `{ping}` `{version}`.
Types: `playing` `streaming` `listening` `watching` `competing` `custom`.
The Streaming activity is skipped unless `PRESENCE_STREAM_URL` points at Twitch or YouTube — the only hosts Discord renders the purple badge for.

---

## Translations

All user-facing text lives in `src/i18n/locales/en.ts` as a flat, typed catalog. GitHuBot ships with English (`en`) and Spanish (`es`); the web dashboard is English-only.

To add one:

1. Create `src/i18n/locales/<code>.ts` exporting a `Partial` of the English catalog. Missing keys fall back to English, so a partial translation is fine.
2. Add `<code>` to `SUPPORTED_LOCALES` and register it in `CATALOGS` in `src/i18n/index.ts`.
3. Map the relevant Discord locale codes to it in `DISCORD_LOCALE_MAP`; command name and description localizations are generated from there automatically.

Servers choose their language with `/repo language`. Resolution order is guild setting → the requester's Discord locale → `DEFAULT_LOCALE`.

---

## Getting started (development)

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 11+
- Discord bot token (`DISCORD_TOKEN`) + application ID (`DISCORD_CLIENT_ID`)

```bash
cp .env.example .env
# fill DISCORD_TOKEN, DISCORD_CLIENT_ID, MASTER_KEY, PUBLIC_WEBHOOK_URL

node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # MASTER_KEY

pnpm install
pnpm db:migrate
pnpm dev
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | yes* | Bot token |
| `DISCORD_CLIENT_ID` | yes* | Application ID |
| `MASTER_KEY` | yes* | 32-byte key (64 hex chars or base64) |
| `PUBLIC_WEBHOOK_URL` | yes* | Public base URL (`https://…` or bare host) |
| `DISCORD_GUILD_ID` | no | Register slash commands to one guild (faster in dev) |
| `DISCORD_ALLOWED_USER_ID` | no | Restrict `/repo` to one Discord user ID |
| `DATABASE_URL` | no | Default `file:/app/data/githubot.db` in Docker; local default `file:./data/githubot.db`; or `postgresql://…` |
| `PORT` / `HOST` | no | Default `3000` / `0.0.0.0` |
| `TRUST_PROXY` | no | `true`/`false` or an IP/CIDR list. Required for per-IP rate limiting behind a proxy |
| `WEBHOOK_BODY_LIMIT` | no | Max delivery size in bytes. Default `26214400` (GitHub's 25 MiB cap) |
| `WEBHOOK_RATE_LIMIT` | no | Deliveries accepted per minute from one IP. Default `600` |
| `METRICS_TOKEN` | no | When set, `/metrics` requires `Authorization: Bearer <token>` |
| `DASHBOARD_ENABLED` | no | Serve the optional read-only web dashboard. Default `false` |
| `DASHBOARD_BASE_URL` | no | Public origin the dashboard is served from (required with the above) |
| `DISCORD_CLIENT_SECRET` | no | OAuth2 client secret, for dashboard sign-in only |
| `DASHBOARD_SESSION_HOURS` | no | Dashboard sign-in lifetime. Default `12` |
| `LOG_LEVEL` | no | Default `info` |
| `DEFAULT_THEME` | no | `default` · `github` · `neon` · `mono` · `language` |
| `DEFAULT_DISPLAY_MODE` | no | `detailed` (default) or `compact` |
| `DEFAULT_LOCALE` | no | Default `en` |
| `EMOJI_OVERRIDES` | no | JSON map of icon key → custom emoji |
| `PRESENCE_STREAM_URL` | no | Twitch/YouTube URL enabling the Streaming activity |
| `PRESENCE_ROTATION` | no | JSON array replacing the built-in presence lineup |

<sub>*Required for full Discord + webhook mode. Without them the process still serves `/health` (degraded boot).</sub>

Malformed JSON in `EMOJI_OVERRIDES` or `PRESENCE_ROTATION` is treated as unset rather than fatal.

**No `GITHUB_TOKEN`.** Do not add one.

### HTTP endpoints

| Route | Purpose |
|---|---|
| `GET /health` | Liveness plus which required env vars are missing (always public) |
| `GET /metrics` | In-process delivery counters as JSON; gated by `METRICS_TOKEN` when set |
| `POST /webhooks/github/:trackingId` | Signed GitHub deliveries |
| `GET /dashboard` | Optional web dashboard; only routed when `DASHBOARD_ENABLED` and configured |

---

## Dashboard (optional)

A read-only web view of delivery status, served by the same process. It is **off by
default** and serves no route at all until you enable it.

```
DASHBOARD_ENABLED=true
DASHBOARD_BASE_URL=https://your-bot.example.com
DISCORD_CLIENT_SECRET=…
```

Then add `<DASHBOARD_BASE_URL>/dashboard/auth/callback` as a redirect URI under
**OAuth2 → Redirects** in the Discord Developer Portal and restart.

Sign-in is Discord OAuth2 with the `identify guilds` scopes — enough to name you and
list your servers, and nothing else. You see only servers where you hold **Manage
Server**, the same gate `/repo` uses; if `DISCORD_ALLOWED_USER_ID` is set, only that
account may sign in at all.

What it can do: view tracked repos, delivery counters, the last error verbatim, event
selection, filters, routing, mentions and appearance — plus **pause/resume** and **send
a test message**. What it cannot do: add or remove repositories, change any setting, or
show a webhook secret. Those stay in Discord, behind `/repo`.

It is server-rendered with no build step, no JavaScript and no CDN — the page works
offline and adds no dependency to the project.

---

## Run it yourself

* **Docker**

```bash
cp .env.example .env
# set PUBLIC_WEBHOOK_URL to your public URL
docker compose up -d --build
```

SQLite persists in the `githubot-data` volume.

* **Railway**

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new)

1. Deploy from this repo (`docker/Dockerfile` via `railway.json`)
2. Attach a volume at **`/app/data`**
3. Set `DATABASE_URL=file:/app/data/githubot.db` (required with the volume)
4. Set the other env vars from the table above
5. Set `PUBLIC_WEBHOOK_URL` to your Railway public domain
6. Set `TRUST_PROXY=true` so per-IP rate limiting sees the real caller

The image entrypoint `chown`s `/app/data` on boot so the non-root process can create SQLite files on Railway volumes.

* **Postgres** — set `DATABASE_URL=postgresql://…` (migrations under `drizzle/pg`)

---

## Upgrading

Deploy and restart. Migrations run automatically on boot, each one in a transaction, and every column added so far is nullable or defaulted — existing tracked repositories keep their channel, event selection and secrets. No release to date has required a new environment variable.

Version-specific notes are in [`CHANGELOG.md`](CHANGELOG.md).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Nothing arrives | Check **Recent Deliveries** on the GitHub webhook page, then `/repo health` |
| `401` on deliveries | Secret mismatch — run `/repo regenerate-secret` and update GitHub |
| `404` on deliveries | Stale Payload URL — re-copy it from `/repo webhook-info` |
| Message never posts | Bot needs **View Channel** and **Send Messages**; `/repo test` will surface the exact error. Once fixed, use **Redeliver** on GitHub to post the missed event |
| Data lost on redeploy | Mount SQLite under `/app/data` and set `DATABASE_URL` to match |
| Secrets stopped working | `MASTER_KEY` changed — run `/repo regenerate-secret` and paste the new secret into GitHub |

---

<a id="security"></a>

## Security

GitHuBot is a **pure webhook receiver**. Secrets are generated locally, stored encrypted (AES-256-GCM), and never sent to GitHub by the bot. Signature checks use `X-Hub-Signature-256` with a constant-time compare; deliveries are deduped with `X-GitHub-Delivery` in a single atomic insert, so a replayed or concurrently redelivered payload can never post twice.

Untrusted GitHub text (commit messages, issue and PR bodies, logins) is escaped before rendering:

- Markdown control characters are escaped in titles and logins.
- Link syntax (`[label](url)`) and leading `#` headings are escaped inside quoted bodies, so a body cannot forge a heading or put attacker-chosen words on an attacker-chosen link.
- Zero-width and bidi-override characters are stripped, so one login cannot visually impersonate another.
- Role pings are scoped with `allowedMentions`, so a commit message cannot trigger one.

Operational hardening:

- Set **`TRUST_PROXY`** in any proxied deployment (Railway, Docker, nginx) — without it every request appears to come from the proxy and the per-IP rate limit collapses into one shared bucket. A bare hop count is rejected because that form is spoofable ([GHSA-3m5p-2c4r-xxw2](https://github.com/fastify/fastify/security/advisories/GHSA-3m5p-2c4r-xxw2)).
- Set **`METRICS_TOKEN`** if the instance is reachable from the internet; `/health` stays public for platform health checks.
- Unhandled errors return a generic body, never the underlying driver message.
- `/repo` autocomplete honours `DISCORD_ALLOWED_USER_ID`, so tracked repo slugs are not enumerable by other Manage Server holders.
- Rate limits are counted before a request body is read, so a flood is refused without buffering it.
- Delivery ids are kept for 30 days — well past GitHub's 3-day redelivery window — and then pruned, so the dedupe ledger stays bounded.

---

<sub>

MIT © [MatiDeZeta](https://github.com/MatiDeZeta) · [GitHuBot](https://github.com/MatiDeZeta/GitHuBot)

</sub>
