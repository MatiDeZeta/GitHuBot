# Changelog

All notable changes to GitHuBot are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
