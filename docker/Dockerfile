# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat python3 make g++ \
	&& corepack enable \
	&& corepack prepare pnpm@11.15.1 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile=false

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-workspace.yaml tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle
RUN pnpm build \
	&& pnpm prune --prod

FROM node:22-alpine AS runtime
RUN apk add --no-cache libc6-compat wget \
	&& addgroup -S githubot && adduser -S githubot -G githubot
WORKDIR /app

# HTTP server port (default 3000)
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_URL=file:./data/githubot.db

COPY --from=build --chown=githubot:githubot /app/node_modules ./node_modules
COPY --from=build --chown=githubot:githubot /app/dist ./dist
COPY --from=build --chown=githubot:githubot /app/package.json ./package.json
COPY --chown=githubot:githubot drizzle ./drizzle

RUN mkdir -p /app/data && chown -R githubot:githubot /app/data

USER githubot
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]
