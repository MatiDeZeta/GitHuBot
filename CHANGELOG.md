# Changelog

All notable changes to GitHuBot are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] — 2026-09-25

Migrations `0004` and `0005` run automatically; each adds nullable columns only.
**Running outside Docker now needs Node.js 24**; the Docker image already ships it.
No new environment variables are required.

### Added

- **Richer security alerts.** Four severity levels, each with its own colour in
  every theme and its own icon, and a badge line under the header —
  `🟠 high · CVSS 7.4 · EPSS 1.2%` — that stays visible in compact mode.
  Dependabot alerts show the affected range and the fix ("upgrade to 4.17.21",
  or "no patched version yet"); code scanning alerts link to the exact line and
  quote the finding; secret scanning alerts say whether the secret still works
  and whether it also leaked publicly. GHSA and CVE ids link to GitHub's advisory
  database and NVD. A secret's value is never read.
- **GitHub's own icons.** The Octicons ship as coloured icons; `pnpm emojis:sync`
  (or `EMOJI_SYNC=true` at startup) uploads them as the bot's application emojis
  and the bot uses them in place of Unicode. `EMOJI_OVERRIDES` still wins.
- **Three new themes:** Catppuccin, Nord, and Accessible (the Okabe–Ito palette,
  distinguishable with the common forms of colour blindness). The language theme
  now knows all 692 of GitHub's language colours.
- **`/repo server-style`** sets the default theme and density for every
  repository in a server. The setting existed in the database but nothing could
  set it.
- **Realistic previews.** `/repo test` renders a lifelike message for 17 common
  events through the real formatter, tagged as a test; `/repo style` and
  `/repo server-style` reply with a preview of a merge and a failed run.
- **Failure alerts.** `/repo alerts channel:#…` posts once when a repository's
  deliveries start failing and once when they recover, instead of the breakage
  being visible only to someone who runs `/repo health`.
- **GitHub's default content type works.** GitHub creates webhooks as
  `application/x-www-form-urlencoded` unless it is changed by hand, and that was
  refused with a 415, so nothing ever posted. Form-encoded deliveries are now
  accepted and verified against the body exactly as GitHub signed it.
  `application/json` is still the recommendation.
- **Channel permission check.** `/repo add`, `/repo channel`, `/repo route` and
  `/repo alerts` check the bot's effective permissions in the chosen channel and
  say what is missing, instead of it surfacing later as a failed delivery.
  Advisory only — the setting is saved either way.
- **Renamed-repository detection.** When a verified delivery names a different
  repository than the one tracked — renamed, transferred, or the webhook was
  added to the wrong repository — `/repo health`, `/repo list` and the dashboard
  say so. It clears itself once deliveries match again.

### Privacy

- **Data is deleted when the bot leaves a server:** settings, tracked
  repositories and delivery records go 7 days after removal. Re-inviting it
  within 7 days cancels this, and Discord outages never count as a removal.
- **`/repo remove`** now deletes the repository's delivery records immediately.
- **`PRIVACY.md`** documents what is stored, what is not, where data goes and
  how it is deleted.

### Fixed

- `pnpm dev`, `pnpm start` and `pnpm db:migrate` now read `.env`. They never
  did, so following the README's setup steps started the bot in degraded mode
  unless every variable was exported by hand.

### Changed

- **Node.js 24 LTS.** The Docker image (`node:24-alpine`, pinned by digest), CI,
  `engines` and `@types/node` move from Node 22, which leaves maintenance in
  April 2027. A new `.nvmrc` pins the same major for local development.
- **`@fastify/rate-limit` 11** masks IPv6 clients to their /64 by default, so
  one host cannot rotate addresses inside its allocation to dodge the limit.
- **`vitest` 5** and **`@types/better-sqlite3` 9** (development only).
- **New dev dependencies**, each pinned and free of install scripts:
  `linguist-languages` (language colours), `@primer/octicons` and
  `@resvg/resvg-wasm` (icon artwork). Their output is committed; production
  loads none of them.

### Database

- `0004_observed_repo` adds `tracked_repos.observed_full_name`.
- `0005_guild_lifecycle` adds `guilds.alert_channel_id` and `guilds.left_at`.

## [1.2.1] — 2026-09-25

A maintenance release: no new environment variables are required and no
migration runs. Deploy and restart.

### Security

- **Untrusted text can no longer plant disguised links.** Titles escaped emphasis
  and code but not square brackets, so any issue, PR, release or discussion title
  could carry a masked link — attacker-chosen words on an attacker-chosen URL — and
  push messages did not escape commit messages or commit author names at all.
  Anyone able to get a commit or a title into a tracked repository, including
  through a merged outside pull request, could use it in the changelog channel.
  Both are now escaped, and role, channel and command pills (`<@&id>`, `<#id>`,
  `</cmd:id>`) are neutralised too: pings were already blocked, but a pill alone
  could pose as a real server role.

### Fixed

- **The `language` theme keeps status colours.** It coloured every event with the
  repository's language, so a failed build, a critical alert and a merge were all
  the same colour. Pass/fail, severity and merged/closed accents now keep their
  meaning; only informational events take the language colour.
- **`/repo style` can return to the server default.** Leaving an option out
  pinned the instance default into the repository, so a later `DEFAULT_THEME`
  change never reached it. Omitted options now keep their value, a "Server
  default" choice clears the override, and choices show translated names.
- **Spanish no longer shows English CI states.** Conclusions, deployment and
  commit states, severities and "…and N more" were English in every language.
- **Messages show when the event happened**, not when GitHuBot received it, so a
  redelivery no longer reads "just now" for something from days earlier.
- **Avatars have alt text** for screen readers.
- **Changing `MASTER_KEY` no longer breaks deliveries.** After a key change, the
  README's recovery step — `/repo regenerate-secret` — kept the old secret as the
  rotation fallback even though it could no longer be decrypted, and that aborted
  every delivery for the repository with a 500. The fallback is now skipped when
  it does not decrypt, regenerate-secret stops carrying one forward, and
  `/repo webhook-info` explains the key change instead of failing generically.
- **GitHub's "Redeliver" works after a failed post.** A delivery that never
  reached Discord (missing channel, missing permissions, send error) stayed
  recorded, so a redelivery — which reuses the `X-GitHub-Delivery` id — was
  ignored as a duplicate. Those deliveries are now released for another attempt.
- **Busy repositories no longer lose events to rate limiting.** The webhook route
  allowed 60 requests a minute per IP, but GitHub sends every repository's
  deliveries from a small shared pool and never retries a 429, so CI-heavy bursts
  (`workflow_job`, `check_run`) were silently dropped. The default is now 600 and
  tunable with `WEBHOOK_RATE_LIMIT`.
- **Rate limits apply before the body is read.** They ran after Fastify had
  buffered the body — up to 25 MiB — so they did not blunt a flood. They now run
  on `onRequest`.
- **Malformed JSON returns 400, not 500.** Any caller could trigger a 500 and an
  error-level log line on demand.
- **Dashboard sign-in works for people in many servers.** The session cookie
  listed every server the user manages, including ones GitHuBot is not in, and
  past about 40 servers the browser silently dropped it, so sign-in looped. It now
  keeps only servers the bot is in and always fits the browser's cookie limit.
- **Repository names are case-insensitive**, as on GitHub: `Acme/App` and
  `acme/app` can no longer be tracked twice, and `/repo remove acme/app` finds a
  repository added as `Acme/App`. The original casing is kept for display.
- **Migrations are transactional.** A file that failed part-way left its earlier
  statements applied but the file unrecorded, so every later boot failed on the
  half-applied state. Each file now commits or rolls back as a whole, on SQLite
  and Postgres.
- **The delivery ledger is bounded.** The `deliveries` table grew by one row per
  webhook, forever. Rows older than 30 days are pruned at boot and every six hours;
  dedupe only needs GitHub's 3-day redelivery window and the dashboard reads 7.
  The trade-off — an authentic delivery replayed after 30 days would post again,
  since GitHub signs no timestamp — is spelled out in `SECURITY.md`.
- **The Docker image builds on current Node images.** Node 25+ images no longer
  ship `corepack`, which the build relied on; pnpm is now installed from npm at the
  version pinned in `package.json`.

### Security — supply chain

- **Dependabot now honours a 3-day cooldown** on npm, actions and docker version
  updates, matching `minimumReleaseAge`. Without it Dependabot would raise PRs for
  releases published minutes earlier — precisely the window the cooldown exists to
  skip. CI already rejected such a PR, since pnpm enforces the policy against the
  lockfile, but not raising it is better than relying on the backstop. Security
  updates deliberately bypass the cooldown so CVE fixes still arrive immediately.
- **Dependabot no longer proposes Node majors** for the base image or
  `@types/node`. A new major is a deliberate runtime upgrade, and odd majors are
  never LTS — it had proposed `node:25-alpine`, which was both and broke the build.
  Action bumps now arrive as one grouped PR.
- **GitHub Actions updated** to `actions/checkout` v7.0.1, `actions/setup-node`
  v7.0.0 and `pnpm/action-setup` v6.1.0, moving CI off the deprecated Node 20
  action runtime. Each pinned SHA was checked against the upstream release tag.
- **Dependencies:** `fastify` 5.12.5, `zod` 4.6.5, `drizzle-orm` 0.45.3,
  `drizzle-kit` 0.31.11, `tsx` 4.23.15 and `@biomejs/biome` 2.5.14, all past the
  72-hour release-age gate. `pnpm audit` is clean.

### Changed

- `src/release.test.ts` fails CI when the version, the Node major or the pnpm
  version disagree between `package.json`, `src/version.ts`, the README, the
  CHANGELOG, the Dockerfile and the CI workflow.
- The lint run is warning-free, and `biome.json` uses Biome's current `preset` key.
- Docs: the README's upgrade section no longer links a release-notes file that was
  never published, it now says Spanish ships alongside English, and
  `CONTRIBUTING.md` describes when CI runs and how to cut a release.
- The drizzle journals list migration `0003_delivery_activity`.

## [1.2.0] — 2026-09-09

### Security — supply chain

Audited the installed tree for malware first: no indicators of compromise, every direct
dependency resolves to its genuine upstream repository, and the only packages permitted to
run install scripts are `better-sqlite3` and `esbuild`. `pnpm store status` flags esbuild
as modified; that is its own `postinstall` swapping its JS shim for the platform binary,
verified byte-identical to `@esbuild/linux-x64`. Then hardened the pipeline:

- **`minimumReleaseAge: 4320`** — nothing published in the last 72 hours can be installed,
  including entries already written into the lockfile, so a compromised release cannot be
  smuggled in via a locally crafted lockfile. Set to 72h rather than a week because
  `fastify@5.12.3` (the CVE fix above) is only 4 days old and a wider gate would force a
  downgrade back into those CVEs.
- **`allowBuilds` is now guarded in CI** — install-time lifecycle scripts are the main
  malware execution vector; the build fails if that allow-list grows.
- **GitHub Actions pinned to commit SHAs** and **the Docker base image pinned by digest** —
  `@v4` and `:22-alpine` are mutable references that can be repointed at other code.
- **Workflow token defaults to `contents: read`**, so a compromised action inherits as
  little as possible.
- **`pnpm store status` runs in CI** to catch packages mutated after extraction.
- **Dependabot** configured for npm, github-actions and docker, so updates are reviewed
  PRs and the SHA/digest pins do not rot.
- **`pnpm audit:supply-chain`** runs the same checks locally.

### Security

- **Delivery dedupe is now atomic.** `tryRecordDelivery` used a `SELECT` followed by a
  separate `INSERT`, so two concurrent deliveries carrying the same `X-GitHub-Delivery`
  could both pass the check and the second would throw a unique-constraint error,
  returning 500 instead of an idempotent duplicate response. Both the SQLite and Postgres
  repositories now use a single `INSERT … ON CONFLICT DO NOTHING … RETURNING`.
- **Added a Fastify error handler.** Unhandled errors returned the underlying driver's
  message (leaking schema details); 5xx responses are now generic and the real error is
  logged instead.
- **`/repo` autocomplete now honours `DISCORD_ALLOWED_USER_ID`.** Autocomplete answers
  before Discord validates the submit, so any other Manage Server holder could enumerate
  tracked repository slugs even though the command itself was correctly blocked.
- **Untrusted body text can no longer forge links or headings.** Quoted issue, PR and
  release bodies now escape `[label](url)` link syntax and leading `#` headings — a
  blockquote does not neutralise either. Zero-width and bidi-override characters are
  stripped from titles, logins and bodies so one identity cannot visually impersonate
  another.
- **`TRUST_PROXY`** — new setting. Without it `request.ip` is the proxy's address behind
  Railway/Docker/nginx, so the per-IP rate limit shared one bucket across all callers. A
  bare hop count is rejected because that form is spoofable
  ([GHSA-3m5p-2c4r-xxw2](https://github.com/fastify/fastify/security/advisories/GHSA-3m5p-2c4r-xxw2)).
- **`METRICS_TOKEN`** — new setting. Optionally gates `/metrics` behind a bearer token,
  compared in constant time. `/health` stays public for platform health checks.
- **Log redaction** — pino now redacts secret, token and signature fields defensively.
- **Dependencies** — `fastify` floor raised to `^5.12.1`, closing CVE-2026-16732 and
  CVE-2026-18504; `esbuild` overridden to `>=0.25.0` to clear GHSA-67mh-4wv8-2f99 from
  drizzle-kit's deprecated transitive chain. `pnpm audit` is clean and now runs in CI.

### Added

- **Optional read-only web dashboard** (`DASHBOARD_ENABLED`). Discord OAuth2 sign-in
  scoped to servers where you hold Manage Server; shows delivery health, the last error
  verbatim, event selection, filters, routing, mentions and appearance, and can pause,
  resume or send a test message. It cannot add or remove repositories, change settings,
  or reveal a webhook secret — those stay behind `/repo`. Server-rendered with **no new
  dependencies**, no build step and no CDN, so it works offline and does not widen the
  supply-chain surface. Off by default: with the flag unset no route is registered at
  all. Sessions are HMAC-signed cookies keyed by a value derived from `MASTER_KEY`
  (not `MASTER_KEY` itself), `HttpOnly`/`SameSite=Lax`/`Secure`, with constant-time
  CSRF and OAuth-state checks.
- **Dashboard redesign.** Repositories are now cards rather than table rows: a
  colour tile derived from the repository name, a delivery-health bar showing the
  real delivered/failed split, a seven-day activity sparkline, and the failure
  reason inline. Anything failing sorts first, since that is why the page gets
  opened. Instance metrics moved into a single four-cell panel, and the detail
  page renders each event category as a progress bar in that category's own
  accent colour. Near-black surfaces with colour reserved for status.
- **New `activityByDay` query** (plus a `deliveries (tracking_id, created_at)`
  index, migration `0003_delivery_activity`) backing the sparklines. It aggregates
  the existing deliveries ledger by UTC day, so it counts events *received* per
  repository — including ones later filtered — rather than messages posted.
- **Dashboard hardening for internet-facing hosts.** Every dashboard response now
  carries a strict CSP — `script-src 'none'` is achievable because the page ships no
  JavaScript, so an escaping mistake still could not execute — plus
  `frame-ancestors 'none'`/`X-Frame-Options: DENY`, `form-action 'self'`,
  `base-uri 'none'`, `nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP, HSTS on
  https, and `Cache-Control: no-store`. Session and OAuth-state cookies take the
  `__Host-` prefix over https. The routes moved into an encapsulated Fastify plugin so
  the form parser and headers cannot leak onto the webhook endpoint, and the two
  unauthenticated auth routes are rate-limited to 10/min.
- **Six new event types** (42 → 48), all verified as repository-webhook-scoped against
  [GitHub's webhook documentation](https://docs.github.com/en/webhooks/webhook-events-and-payloads):
  `sub_issues` and `issue_dependencies` (issues), `repository_advisory`,
  `repository_ruleset` and `security_and_analysis` (security), and
  `custom_property_values` (repository & meta).
- **`WEBHOOK_BODY_LIMIT`** — the body limit was 1 MiB while GitHub sends up to 25 MiB, so
  large pushes and release bodies were rejected with a 413 before signature verification
  and silently lost. The default is now GitHub's own 25 MiB cap, and the value is
  tunable for operators who would rather buffer less per request.
- **`/repo filters` now uses Discord's `Label` component.** Discord deprecated Text Input
  inside an Action Row for modals; each filter field is now a `Label` (type 18) wrapping
  its input, which also gives every field a description line the old layout had nowhere
  to put. ([Components reference](https://docs.discord.com/developers/components/reference))
- **HTTP-layer test coverage** — the Fastify webhook route had none. New tests cover the
  signed happy path, bad and tampered signatures, unknown tracking ids, missing headers,
  replayed deliveries, the concurrent-replay race above, the body limit, and
  `/metrics` authentication.

### Changed

- `security_advisory` is documented as GitHub-App-only; a repository webhook never
  receives it. It is kept for existing configurations, with `repository_advisory` added
  as the repository-scoped equivalent.
- CI now runs on push and pull request to `main`, not `workflow_dispatch` only, and
  installs with `--frozen-lockfile`. `pnpm-lock.yaml` is committed so builds are
  reproducible and auditable.
- The repository is now formatted to its own Biome configuration.

## [1.1.0] — 2026-07-26

### Added

- **Full GitHub event catalog** — 42 event types across nine categories (code,
  pull requests, issues, CI/CD, releases, discussions, security, community,
  repository/meta), up from 11.
- **Two-step event picker** — `/repo events` now opens a category select, then a
  toggle list scoped to that category, keeping every menu under Discord's
  25-option limit. Presets: Minimal, Standard, Everything, Disable all.
- **Declarative rendering layer** (`src/bot/render/`) — formatters return a
  plain `EventTemplate` and a single renderer turns it into Components V2,
  budgeting against the 40-component / 4000-character message limits.
- **Themes** — `default`, `github`, `neon`, `mono` and `language` (accent
  derived from the repository's primary language), selectable per repository
  with `/repo style`.
- **Display density** — `detailed` (fields, separators, media galleries,
  relative timestamps) or `compact` (one line plus links).
- **Delivery filters** — `/repo filters` sets branch include/exclude globs,
  label allow-lists and ignored authors (`bot` matches every bot account).
- **Event routing** — `/repo route` sends a whole category to a different
  channel, including forum and media channels (each event becomes a post).
- **Role mentions** — `/repo mentions` pings a role for a category, with
  `allowedMentions` scoped so nothing else can be pinged.
- **Pause / resume** — `/repo pause` and `/repo resume` mute a repository
  without touching the GitHub webhook.
- **Delivery health** — `/repo health` shows delivered/failed counts, last
  delivery, last success and the last error verbatim.
- **`/repo test`** — posts a sample message for any event type into the real
  target channel to verify permissions and routing.
- **New commands** — `/help` (topic-based setup guide), `/stats` (uptime,
  counters, gateway latency, busiest repos), `/about`, `/ping`.
- **Repository autocomplete** on every `repository` option, plus autocomplete
  for `/repo test`'s event type.
- **Metrics registry** (`src/metrics.ts`) — in-process counters for received,
  delivered, failed, filtered and duplicate deliveries, exposed at `/metrics`
  and consumed by `/stats` and the presence rotation.
- **Configurable presence** — metrics-driven rotation with `{repos}`,
  `{servers}`, `{events}`, `{uptime}`, `{ping}` and `{version}` placeholders,
  optional Streaming activity via `PRESENCE_STREAM_URL`, and full override via
  `PRESENCE_ROTATION`.
- **i18n infrastructure** (`src/i18n/`) — flat typed catalog, `t()` / `tp()`
  helpers with `{placeholder}` interpolation, guild language preference via
  `/repo language`, and command localization wiring. English only for now;
  adding `locales/<code>.ts` is a drop-in.
- **Emoji overrides** — `EMOJI_OVERRIDES` swaps any built-in Unicode icon for a
  custom application emoji without a code change.
- New optional env vars: `PRESENCE_STREAM_URL`, `PRESENCE_ROTATION`,
  `EMOJI_OVERRIDES`, `DEFAULT_LOCALE`, `DEFAULT_THEME`, `DEFAULT_DISPLAY_MODE`.

### Changed

- `handleWebhook` is restructured around an explicit pipeline: verify → dedupe →
  pause → enabled → filters → build → render → route → mention → send → record.
- Noisy events are suppressed by default: successful workflow jobs, check runs
  and check suites, `pending` commit statuses, and `synchronize` pull request
  updates no longer produce messages.
- `/repo list` now shows pause state, route count, active filters and the last
  delivery time.
- Slash commands use `setContexts` instead of the deprecated `setDMPermission`.
- Presence rotates every 45 seconds (was 30) to stay further from Discord's
  presence rate limit.

### Fixed

- Untrusted GitHub text (issue titles, comment bodies) is escaped and quoted so
  it cannot forge headings or break the layout.
- Link buttons deduplicate by URL and skip non-`http(s)` targets, which Discord
  rejects.

### Database

- Migration `0002_v110` adds `paused`, `display_mode`, `theme`, `locale`,
  `branch_include`, `branch_exclude`, `label_filter`, `ignored_actors`,
  `event_routes`, `mention_rules` and six health columns to `tracked_repos`,
  plus `locale`, `default_theme` and `default_display_mode` to `guilds`.
  Every column is nullable or defaulted, so existing rows upgrade untouched.

## [1.0.3] — 2026-07-23

### Fixed

- `/repo add` no longer hangs on "thinking…" — deferred replies opt into
  Components V2 up front instead of trying to add the flag during `editReply`.
- Interaction error handling replies with Components V2 text rather than legacy
  `content` follow-ups, which Discord rejects after a V2 defer.
- `editReply` flags are cast to `InteractionEditReplyOptions["flags"]` so the
  Docker TypeScript build succeeds.
- Env parsing trims whitespace and strips one pair of wrapping quotes.

## [1.0.2] — 2026-07-22

### Fixed

- Webhook secret rotation keeps the previous secret until GitHub signs a
  delivery with the new one, so nothing is dropped during the cutover.

## [1.0.1] — 2026-07-21

### Fixed

- SQLite migrations create the data directory before opening the database, so a
  fresh Railway volume boots cleanly.

## [1.0.0] — 2026-07-20

### Added

- Initial release: `/repo add|remove|list|events|channel|webhook-info|regenerate-secret`,
  Components V2 changelog messages, AES-256-GCM encrypted webhook secrets,
  signature verification, delivery deduplication, SQLite and Postgres support.

[Unreleased]: https://github.com/MatiDeZeta/GitHuBot/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/MatiDeZeta/GitHuBot/releases/tag/v1.3.0
[1.2.1]: https://github.com/MatiDeZeta/GitHuBot/releases/tag/v1.2.1
[1.2.0]: https://github.com/MatiDeZeta/GitHuBot/releases/tag/v1.2.0
[1.1.0]: https://github.com/MatiDeZeta/GitHuBot/releases/tag/v1.1.0
[1.0.3]: https://github.com/MatiDeZeta/GitHuBot/releases/tag/v1.0.3
[1.0.2]: https://github.com/MatiDeZeta/GitHuBot/releases/tag/v1.0.2
[1.0.1]: https://github.com/MatiDeZeta/GitHuBot/releases/tag/v1.0.1
[1.0.0]: https://github.com/MatiDeZeta/GitHuBot/releases/tag/1.0.0
