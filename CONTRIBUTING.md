# Contributing to GitHuBot

Thanks for helping improve GitHuBot.

## Development setup

1. Install **Node.js 22+** and **pnpm 11+**.
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

## Commit style

Conventional Commits are preferred (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).

## Pull requests

1. Fork and create a feature branch.
2. Ensure `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass locally (CI is manual via `workflow_dispatch` only).
3. Open a PR against `main` with a short summary and test notes.
