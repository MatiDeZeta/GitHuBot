# syntax=docker/dockerfile:1

# Base images are pinned by digest, not by the mutable `24-alpine` tag, so a
# rebuild cannot silently pick up a different image. Dependabot's docker
# ecosystem keeps the digest current.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
# pnpm comes from npm rather than corepack: Node 25+ images no longer ship
# corepack at all. The version matches `packageManager` in package.json, and
# --ignore-scripts keeps the global install from running any lifecycle hook.
RUN apk add --no-cache libc6-compat python3 make g++ \
	&& npm install --global --ignore-scripts pnpm@11.15.1
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-workspace.yaml tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle
RUN pnpm build \
	&& pnpm prune --prod

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
RUN apk add --no-cache libc6-compat wget su-exec \
	&& addgroup -S githubot && adduser -S githubot -G githubot
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_URL=file:/app/data/githubot.db
ENV GITHUBOT_DATA_DIR=/app/data

COPY --from=build --chown=githubot:githubot /app/node_modules ./node_modules
COPY --from=build --chown=githubot:githubot /app/dist ./dist
COPY --from=build --chown=githubot:githubot /app/package.json ./package.json
COPY --chown=githubot:githubot drizzle ./drizzle
COPY docker/entrypoint.sh /entrypoint.sh

RUN mkdir -p /app/data \
	&& chown -R githubot:githubot /app/data \
	&& chmod +x /entrypoint.sh

# Entrypoint starts as root, chowns the volume mount, then drops to githubot.
USER root
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
	CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
