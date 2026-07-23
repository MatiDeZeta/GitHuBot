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

## Out of scope (by design)

- Asking the bot to hold a `GITHUB_TOKEN` or call the GitHub API — that is intentionally unsupported.
- Compromised Discord bot tokens or leaked `MASTER_KEY` / webhook secrets from operator misconfiguration — rotate those credentials immediately.
