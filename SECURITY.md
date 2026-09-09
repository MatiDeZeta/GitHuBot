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

## Out of scope (by design)

- Asking the bot to hold a `GITHUB_TOKEN` or call the GitHub API — that is intentionally unsupported.
- Compromised Discord bot tokens or leaked `MASTER_KEY` / webhook secrets from operator misconfiguration — rotate those credentials immediately.
