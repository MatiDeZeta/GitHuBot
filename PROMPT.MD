## 1. Role & Objective
 
You are building **a production-grade, open-source Discord bot from scratch** that replaces GitHub's default (ugly, generic) Discord webhook integration with a custom bot that posts beautifully formatted, branded changelog messages for repository activity — commits, pushes, merges, pull requests, issues, releases, and more.
 
The end result must be:
- Deployable with one click on **Railway**
- Deployable via **Docker** on any VPS (docker-compose included)
- Published as a **public GitHub repository** with professional, polished presentation (README, badges, CI, license, contribution guide)
- Built entirely with **current, actively maintained tooling** — no deprecated packages, no Embeds API, no CommonJS.
## 2. Tech Stack (use these exact choices unless a better current alternative exists — verify versions at build time)
 
| Concern | Choice |
|---|---|
| Runtime | Node.js 22 LTS |
| Language | TypeScript 5.x, strict mode, ESM only (`"type": "module"`) |
| Package manager | pnpm |
| Discord library | discord.js v14.27+ (must support **Components V2**) |
| HTTP server (webhook receiver) | Fastify 5 |
| GitHub signature verification | `@octokit/webhooks` (verification only — **no GitHub API token, no `@octokit/rest`, no write access to GitHub is required anywhere in this project**) |
| Database / ORM | Drizzle ORM + SQLite (`better-sqlite3` or `libsql`), swappable to Postgres via `DATABASE_URL` |
| Validation | Zod (env vars, webhook payloads, command inputs) |
| Logging | pino (structured JSON logs, pretty-printed in dev) |
| Lint & format | Biome (replaces ESLint + Prettier) |
| Testing | Vitest |
| Containerization | Docker, multi-stage build, non-root user, small final image (node:22-alpine) |
| CI/CD | GitHub Actions (lint, typecheck, test, build, Docker image build) |
| Hosting targets | Railway (native Dockerfile deploy + persistent volume) and any Docker/VPS host via `docker-compose.yml` |
 
## 3. Core Functional Requirements
 
### 3.1 Dynamic, per-server repo management via **zero-credential, user-configured webhooks**
 
Deliberate design decision: **the bot never holds a GitHub token or any credential with write access to the user's GitHub account.** It only ever *receives* HTTP requests from GitHub — it never calls the GitHub API to create, edit, or delete anything. This is safer for a publicly-hosted, open-source project: even a full compromise of the bot's host cannot leak or misuse GitHub credentials, because there are none.
 
Instead, adding a repo is a short guided flow between the bot and the user:
 
- Slash commands (guild-scoped, restricted to users with `Manage Server` permission):
  - `/repo add owner/repo [channel]` — validates the `owner/repo` format, creates a DB record with a **unique random tracking ID** and a **unique random webhook secret** (both generated locally, never sent to GitHub by the bot). Replies **ephemerally** with step-by-step setup instructions:
    1. Go to `github.com/owner/repo/settings/hooks/new`
    2. **Payload URL**: `https://<your-domain>/webhooks/github/<trackingId>`
    3. **Content type**: `application/json`
    4. **Secret**: `<generated secret, shown once>`
    5. Choose "Send me everything" (simplest) or pick individual events — either way, the bot filters server-side based on the `/repo events` config, so over-sending from GitHub is harmless.
  - `/repo webhook-info owner/repo` — ephemeral re-display of the Payload URL and secret in case the user needs to reconfigure or rotate it (secret is stored encrypted at rest, so it can be decrypted and shown again — not just hashed).
  - `/repo regenerate-secret owner/repo` — invalidates the old secret and issues a new one; user must update it on the GitHub side.
  - `/repo remove owner/repo` — deletes the DB record and reminds the user (ephemeral message) to also delete the webhook manually from the GitHub repo's Settings → Webhooks page, since the bot cannot do this itself.
  - `/repo list` — shows all tracked repos for the server with their target channel and enabled events, rendered as a Components V2 list.
  - `/repo events owner/repo` — opens a select menu to toggle which event types are posted for that repo (push, pull_request, merge, issues, releases, stars, forks, workflow runs, discussions).
  - `/repo channel owner/repo #channel` — reassign the output channel per repo.
- Each tracked repo gets its **own unique webhook path (`trackingId`) and its own unique secret**, generated locally and stored encrypted at rest (AES-256-GCM, key from a `MASTER_KEY` env var). The `trackingId` in the URL path means incoming requests are routed straight to the correct DB record without needing to guess or iterate over secrets — the secret is then used purely to verify the `X-Hub-Signature-256` header.
- Optional, best-effort UX touch: since no token is used, `/repo add` cannot verify the repo exists via an authenticated call — it may optionally do a lightweight *unauthenticated* `GET https://api.github.com/repos/owner/repo` check for public repos to catch typos (60 req/hour unauthenticated rate limit applies, so this must fail open/skip gracefully rather than block the command).
### 3.2 GitHub event coverage
Handle at minimum the following webhook events, each with a dedicated formatter:
- `push` — grouped/batched commit list (avoid spamming one message per commit; collapse a push into a single message summarizing all commits, with short SHA, first line of message, author, and link).
- `pull_request` — opened, closed, reopened, and **merged** (distinguish `closed` vs `merged: true` — a merge is a distinct visual state, not a generic close).
- `issues` — opened, closed, reopened.
- `issue_comment` / `pull_request_review` — new comments/reviews (optional, toggleable, off by default to avoid noise).
- `release` — published releases with tag, notes summary, and asset count.
- `create` / `delete` — branch and tag creation/deletion.
- `fork` and `star` (watch) — optional, toggleable, off by default.
- `workflow_run` — CI status (success/failure), optional.
Verify every incoming payload's `X-Hub-Signature-256` header against the stored per-repo secret using constant-time comparison before processing anything.
 
### 3.3 Visual design — Discord Components V2 (mandatory, no legacy Embeds)
- Every message sent by the bot **must** use Components V2 (`MessageFlags.IsComponentsV2`, i.e. flag `1 << 15`). Do not use `content` or `embeds` fields — use `ContainerBuilder`, `TextDisplayBuilder`, `SectionBuilder`, `SeparatorBuilder`, `ThumbnailBuilder`, `MediaGalleryBuilder`, and `ActionRowBuilder` with link-style `ButtonBuilder`s instead.
- Design system:
  - Each event type gets a distinct **accent color** on the `Container` (e.g. green for merged PRs, red for closed/failed, blue for new PRs, purple for releases, gray for pushes).
  - Author's GitHub avatar as a `Thumbnail` inside a `Section`.
  - Clear typographic hierarchy inside `TextDisplay` blocks: bold repo name, event summary line, secondary details in smaller/quoted markdown, monospace short SHAs.
  - `ActionRow` with link buttons ("View Commit", "View Pull Request", "View Release", etc.) pointing to the GitHub URL — never dump raw links in the text.
  - `Separator` components to visually break sections (e.g., separating the commit list in a push event).
  - Keep it minimal and refined — no emoji spam, no walls of text. Think "changelog," not "notification firehose."
### 3.4 Persistence
- Tables: `guilds`, `tracked_repos` (guild_id, owner/repo, channel_id, webhook_id, encrypted_secret, enabled_events\[]), and `deliveries` (optional dedupe log keyed by GitHub's `X-GitHub-Delivery` header to reject retried duplicate deliveries).
- Default to a local SQLite file on a mounted volume (works out of the box on Railway and Docker). Document how to switch to Postgres for larger multi-server deployments.
### 3.5 Security & reliability
- **No GitHub credentials exist anywhere in the system** — this is the core security property of the design. The bot is a pure webhook *receiver*; it never authenticates to GitHub's API. Document this explicitly and prominently in the README as a security feature of the project.
- Validate every webhook signature (HMAC SHA-256, via `X-Hub-Signature-256`) against the per-repo secret before touching the payload. Route incoming requests to the correct repo/secret using the unguessable `trackingId` in the URL path (e.g. `/webhooks/github/:trackingId`), then verify the signature with that repo's stored secret.
- Reject/deduplicate retried deliveries using the `X-GitHub-Delivery` header.
- Rate-limit the webhook endpoint at the Fastify layer.
- Never log secrets, and never re-display a repo's secret in a non-ephemeral (publicly visible) message.
- Graceful handling of Discord API rate limits (discord.js handles most of this, but batch/queue bursts from large pushes).
- `/health` endpoint (Fastify) for Railway/Docker health checks.
## 4. Project Structure (suggested)
 
```
.
├── src/
│   ├── bot/                # discord.js client, command loader, event handlers
│   │   ├── commands/
│   │   └── components/     # Components V2 message builders (one per GitHub event type)
│   ├── server/              # Fastify app: /webhooks/github, /health
│   ├── github/               # signature verification (@octokit/webhooks), payload type guards — no API client, no token
│   ├── db/                   # Drizzle schema + migrations + client
│   ├── config/                # Zod-validated env schema
│   └── index.ts               # boots Fastify + discord.js together
├── docker/
│   └── Dockerfile
├── docker-compose.yml
├── railway.json (or nixpacks/Dockerfile-based config)
├── .env.example
├── drizzle/                    # generated migrations
├── .github/workflows/ci.yml
├── README.md
├── CONTRIBUTING.md
└── LICENSE (MIT)
```
 
## 5. Deployment Requirements
 
- **Dockerfile**: multi-stage (build stage with pnpm install + tsc, runtime stage copying only `dist/` + `node_modules` production deps), runs as non-root user, exposes the Fastify port, includes a `HEALTHCHECK`.
- **docker-compose.yml**: bot service + named volume for the SQLite file, `.env` file support, for self-hosted VPS use.
- **Railway**: must deploy directly from the Dockerfile with zero extra config beyond environment variables; document required env vars (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `MASTER_KEY`, `PUBLIC_WEBHOOK_URL`, `DATABASE_URL` or SQLite path — **no GitHub token required**) and Railway volume setup for persistence. Include a "Deploy on Railway" button in the README if feasible.
## 6. Repository Polish (this is public, make it look professional)
 
- README with: project description, feature list, screenshots/GIF placeholders of the Components V2 messages, quick-start (local + Docker + Railway), full environment variable table, architecture diagram (Mermaid is fine), and badges (build status, license, discord.js version, node version).
- `CONTRIBUTING.md` and issue/PR templates.
- MIT license.
- GitHub Actions CI on every PR: install, lint (Biome), typecheck, test (Vitest), Docker build check.
- Semantic commit convention recommended.
## 7. Deliverables Checklist
 
- [ ] Bot connects to Discord and registers slash commands (guild + global as appropriate)
- [ ] `/repo add|remove|list|events|channel|webhook-info|regenerate-secret` fully functional, permission-gated
- [ ] Per-repo unique tracking ID + secret generation and encrypted storage (zero GitHub credentials anywhere in the codebase)
- [ ] Ephemeral, clear setup instructions returned by `/repo add` guiding the user through manual GitHub webhook creation
- [ ] Fastify webhook receiver with path-based routing (`/webhooks/github/:trackingId`), signature verification, dedupe, rate limiting, `/health`
- [ ] Components V2 message builders for every event type listed in 3.2, with the accent-color/thumbnail/button design system from 3.3
- [ ] Drizzle schema + migrations, working locally with SQLite
- [ ] Dockerfile + docker-compose.yml, verified to run end-to-end
- [ ] Railway-ready configuration and documented deploy steps
- [ ] CI pipeline green
- [ ] Polished README, LICENSE, CONTRIBUTING, .env.example
Reference docs to consult while implementing: Discord Components V2 reference (`docs.discord.com/developers/components/reference`), discord.js Components V2 guide, GitHub Webhooks docs (`docs.github.com/en/webhooks`) — specifically webhook creation, event payload reference, and signature validation.