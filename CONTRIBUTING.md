# Contributing to GitHuBot

Thanks for helping improve GitHuBot.

## Development setup

1. Install **Node.js 24 LTS** (see `.nvmrc`) and **pnpm 11+**.
2. Copy `.env.example` to `.env` and fill in Discord credentials, `MASTER_KEY`, and `PUBLIC_WEBHOOK_URL`.
3. Install dependencies: `pnpm install`
4. Run migrations: `pnpm db:migrate`
5. Start in watch mode: `pnpm dev`

## Scripts

| Command | Purpose |
|---|---|
| `pnpm lint` | Biome lint + format check |
| `pnpm typecheck` | TypeScript `--noEmit` |
| `pnpm test` | Vitest |
| `pnpm build` | Compile to `dist/` |

## Guidelines

- Use **TypeScript ESM** only — no CommonJS.
- Do **not** add GitHub API write clients or token-based auth. The bot is a pure webhook receiver.
- Discord event messages must use **Components V2** (`MessageFlags.IsComponentsV2`). No embeds.
- Prefer small, focused PRs with a clear description.
- Add or update Vitest coverage for crypto, verification, and formatters when touching those areas.

## Releasing

The version lives in `package.json`, `src/version.ts`, the README badge and `CHANGELOG.md`; `src/release.test.ts` fails if they disagree. To cut a release:

1. Move the `[Unreleased]` notes under a new `## [x.y.z] — YYYY-MM-DD` heading and add its link at the bottom.
2. Bump `package.json`, `src/version.ts` and the README badge.
3. After merging to `main`, tag that commit `vx.y.z` and publish a GitHub release from it.

## Commit style

Conventional Commits are preferred (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).

## Pull requests

1. Fork and create a feature branch.
2. Ensure `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass locally. CI runs the same checks, plus `pnpm audit:supply-chain` and a Docker build, on every push and pull request to `main`.
3. Open a PR against `main` with a short summary and test notes.
