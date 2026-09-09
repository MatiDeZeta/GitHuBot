# Changelog

All notable changes to GitHuBot are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[1.1.0]: https://github.com/MatiDeZeta/GitHuBot/releases/tag/v1.1.0
[1.0.3]: https://github.com/MatiDeZeta/GitHuBot/releases/tag/v1.0.3
[1.0.2]: https://github.com/MatiDeZeta/GitHuBot/releases/tag/v1.0.2
[1.0.1]: https://github.com/MatiDeZeta/GitHuBot/releases/tag/v1.0.1
[1.0.0]: https://github.com/MatiDeZeta/GitHuBot/releases/tag/v1.0.0
