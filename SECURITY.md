# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| `v1.x` (latest release) | ✅ |
| Older tags / forks | ❌ — please upgrade |

## Reporting a vulnerability

GitHuBot stores encrypted webhook secrets and Discord credentials. Please **do not** open a public issue for security problems.

1. Prefer [GitHub Security Advisories](https://github.com/MatiDeZeta/GitHuBot/security/advisories/new) (private).
2. Include: affected version/commit, impact, and steps to reproduce (redact real secrets).
3. You should get an acknowledgement when practical; fixes are prioritized by severity.

## Trust boundaries

- **Webhook payload text is untrusted.** Anyone who can open an issue or PR on a tracked
  public repository can put text into a GitHuBot message. Titles, logins and bodies are
  escaped (markdown control characters, link syntax, leading headings, zero-width and
  bidi characters) and role pings are scoped with `allowedMentions`. Bodies still render
  ordinary formatting such as emphasis and code blocks — that is deliberate.
- **`/metrics` is public unless `METRICS_TOKEN` is set.** It exposes delivery counters and
  uptime, not secrets or repository names.
- **Rate limiting depends on `TRUST_PROXY`.** In a proxied deployment without it, the
  per-IP limit degrades to a single shared bucket.

## Dashboard

The optional web dashboard (`DASHBOARD_ENABLED`) is the only part of GitHuBot that
accepts browser traffic, so it is deliberately narrow:

- **Off by default.** With `DASHBOARD_ENABLED` unset, no `/dashboard` route is
  registered at all — not even a sign-in page.
- **Discord OAuth2 only**, scopes `identify guilds`. There is no password and no local
  account. A user sees only guilds where Discord itself reports `MANAGE_GUILD`, and
  every repo-scoped request re-checks that list; `DISCORD_ALLOWED_USER_ID`, when set,
  restricts sign-in to that one account.
- **Read-only plus two actions.** Pause/resume and send-test are the only writes. The
  dashboard cannot add or remove repositories, change any setting, or display a webhook
  secret — those stay behind `/repo` in Discord.
- **Sessions are signed, not stored**: an HMAC over a JSON payload, keyed by a value
  derived from `MASTER_KEY` rather than `MASTER_KEY` itself, so a signing flaw cannot
  become a decryption oracle. Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure`
  whenever the base URL is https.
- **CSRF is checked on every action** with a per-session token compared in constant
  time, and the OAuth `state` parameter is checked the same way to prevent login CSRF.
- **All rendered values are HTML-escaped**, including `lastError`, which can carry
  attacker-influenced repository text.
- **The page ships no JavaScript at all**, so it is served under
  `script-src 'none'` — an escaping mistake could not execute anything even if one
  slipped through. Alongside it: `frame-ancestors 'none'` and `X-Frame-Options: DENY`
  (clickjacking), `form-action 'self'`, `base-uri 'none'`, `nosniff`,
  `Referrer-Policy: no-referrer`, `Cross-Origin-Opener/Resource-Policy: same-origin`,
  and HSTS on https.
- **`Cache-Control: no-store`** on every dashboard response, so per-user data is never
  held by a proxy or returned by the back button after sign-out.
- **Cookies use the `__Host-` prefix over https**, which browsers only accept on a
  Secure, `Path=/`, domain-less cookie — a compromised sibling subdomain cannot
  overwrite the session.
- **The routes are an encapsulated Fastify plugin**, so the form-body parser and these
  headers apply to the dashboard only; the webhook endpoint still refuses anything but
  JSON (verified by test).
- **`/dashboard/login` and the OAuth callback are rate-limited** to 10/min, well under
  the global allowance, since both are unauthenticated and each costs a Discord call.

## Supply chain

A bot that holds a Discord token and decrypts webhook secrets is a worthwhile target, and
the realistic path in is a dependency rather than this code. The controls below are all
enforced in CI, so they fail a pull request rather than relying on anyone remembering.

| Control | Where | What it stops |
| --- | --- | --- |
| `minimumReleaseAge: 4320` (72h) | `pnpm-workspace.yaml` | A version published in the last 72 hours cannot be installed — including one already written into the lockfile. Compromised releases are typically yanked within hours, so this skips the exposure window entirely. |
| `allowBuilds` allow-list | `pnpm-workspace.yaml` | Install-time lifecycle scripts are the main malware execution path. pnpm blocks them by default; only `better-sqlite3` and `esbuild` may run, both because they link a native binary. CI fails if that list changes. |
| Committed `pnpm-lock.yaml` + `--frozen-lockfile` | CI, `docker/Dockerfile` | No dependency can enter the tree without a reviewed lockfile diff. |
| `pnpm audit --audit-level moderate` | CI | Fails the build on known advisories. |
| `pnpm store status` | CI | Recomputes every package's hash and reports files mutated after extraction. |
| Actions pinned by commit SHA | `.github/workflows/ci.yml` | A tag like `@v4` is mutable and can be repointed at malicious code; a SHA cannot. |
| Base image pinned by digest | `docker/Dockerfile` | A rebuild cannot silently pull a different `node:22-alpine`. |
| Dependabot (npm, actions, docker) | `.github/dependabot.yml` | Updates arrive as reviewable PRs, and the SHA/digest pins stay current instead of rotting. |

Run the same checks locally with `pnpm audit:supply-chain`.

**Expected finding:** `pnpm store status` always reports `esbuild` as modified. That is
esbuild's own `postinstall` replacing its JS shim with the platform binary — the result is
byte-identical to the binary in `@esbuild/linux-x64`, whose hash pnpm verifies. Any *other*
package reported as modified is not expected and should be investigated.

**Emergency override.** For a same-day security patch you have actually read, bypass the
cooldown per command rather than lowering it permanently:

```bash
pnpm add <pkg>@<version> --config.minimumReleaseAge=0
```

## Out of scope (by design)

- Asking the bot to hold a `GITHUB_TOKEN` or call the GitHub API — that is intentionally unsupported.
- Compromised Discord bot tokens or leaked `MASTER_KEY` / webhook secrets from operator misconfiguration — rotate those credentials immediately.
