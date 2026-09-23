# syntax=docker/dockerfile:1

# Base images are pinned by digest, not by the mutable `22-alpine` tag, so a
# rebuild cannot silently pick up a different image. Dependabot's docker
# ecosystem keeps the digest current.
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS base
RUN apk add --no-cache libc6-compat python3 make g++ \
	&& corepack enable \
	&& corepack prepare pnpm@11.15.1 --activate
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

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS runtime
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
