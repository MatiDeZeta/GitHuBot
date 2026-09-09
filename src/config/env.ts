import { z } from "zod";
import { DISPLAY_MODES } from "../bot/render/template.js";
import { THEME_IDS } from "../bot/render/theme.js";
import { SUPPORTED_LOCALES } from "../i18n/index.js";

const masterKeySchema = z
	.string()
	.min(1)
	.refine(
		(value) => {
			const hex = /^[0-9a-fA-F]{64}$/.test(value);
			if (hex) return true;
			try {
				return Buffer.from(value, "base64").length === 32;
			} catch {
				return false;
			}
		},
		{ error: "MASTER_KEY must be 32 bytes as 64 hex chars or base64" },
	);

const emptyToUndefined = (value: unknown) => {
	if (typeof value !== "string") return value;
	const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
	return trimmed === "" ? undefined : trimmed;
};

/** Accept full URLs or bare hosts like `foo.up.railway.app` (assumes https). */
function normalizePublicWebhookUrl(value: unknown): unknown {
	const cleared = emptyToUndefined(value);
	if (typeof cleared !== "string") return cleared;
	const trimmed = cleared.trim().replace(/\/$/, "");
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	return `https://${trimmed}`;
}

const snowflakeSchema = z
	.string()
	.regex(/^\d{17,20}$/, { error: "Must be a Discord snowflake user ID (17–20 digits)" });

/** Parses a JSON env value, treating malformed input as unset rather than fatal. */
function jsonRecord(value: unknown): unknown {
	const cleared = emptyToUndefined(value);
	if (typeof cleared !== "string") return cleared;
	try {
		const parsed: unknown = JSON.parse(cleared);
		return parsed && typeof parsed === "object" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function jsonArray(value: unknown): unknown {
	const cleared = emptyToUndefined(value);
	if (typeof cleared !== "string") return cleared;
	try {
		const parsed: unknown = JSON.parse(cleared);
		return Array.isArray(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Fastify's numeric `trustProxy` (the "behind N hops" form) is the shape affected by
 * GHSA-3m5p-2c4r-xxw2, so only booleans and explicit IP/CIDR/preset lists are accepted.
 */
const trustProxySchema = z
	.string()
	.refine((value) => !/^\d+$/.test(value.trim()), {
		error:
			"TRUST_PROXY must be true/false or a comma-separated IP/CIDR list (e.g. 'loopback, 10.0.0.0/8'). " +
			"A bare hop count is rejected: it allows X-Forwarded-For spoofing (GHSA-3m5p-2c4r-xxw2).",
	})
	.transform((value): boolean | string => {
		const trimmed = value.trim();
		if (/^(true|yes|1)$/i.test(trimmed)) return true;
		if (/^(false|no|0)$/i.test(trimmed)) return false;
		return trimmed;
	});

/** Accepts the usual spellings operators reach for in a .env file. */
function booleanish(value: unknown): unknown {
	const cleared = emptyToUndefined(value);
	if (typeof cleared !== "string") return cleared;
	if (/^(true|yes|1|on)$/i.test(cleared)) return true;
	if (/^(false|no|0|off)$/i.test(cleared)) return false;
	return cleared;
}

/** GitHub declines to send webhook payloads above 25 MiB, so nothing larger is a real delivery. */
const GITHUB_MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;

/** Discord only renders the purple Streaming badge for these hosts. */
const streamUrlSchema = z
	.url()
	.refine((value) => /^(https?:\/\/)?(www\.)?(twitch\.tv|youtube\.com|youtu\.be)\//i.test(value), {
		error: "PRESENCE_STREAM_URL must be a twitch.tv or youtube.com URL",
	});

const presenceEntrySchema = z.object({
	type: z
		.enum(["playing", "streaming", "listening", "watching", "competing", "custom"])
		.default("watching"),
	name: z.string().min(1),
	state: z.string().min(1).optional(),
});

export type PresenceEntry = z.infer<typeof presenceEntrySchema>;

const envSchema = z.object({
	DISCORD_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
	DISCORD_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
	DISCORD_GUILD_ID: z.preprocess(emptyToUndefined, snowflakeSchema.optional()),
	/** When set, only this Discord user may run /repo commands (and related selects). */
	DISCORD_ALLOWED_USER_ID: z.preprocess(emptyToUndefined, snowflakeSchema.optional()),
	MASTER_KEY: z.preprocess(emptyToUndefined, masterKeySchema.optional()),
	PUBLIC_WEBHOOK_URL: z.preprocess(normalizePublicWebhookUrl, z.url().optional()),
	DATABASE_URL: z.string().default("file:./data/githubot.db"),
	PORT: z.coerce.number().int().positive().default(3000),
	HOST: z.string().default("0.0.0.0"),
	/**
	 * Required for per-IP rate limiting to mean anything behind Railway/Docker/nginx:
	 * without it `request.ip` is the proxy's address for every caller.
	 */
	TRUST_PROXY: z.preprocess(emptyToUndefined, trustProxySchema.optional()),
	/** Raise/lower the accepted GitHub delivery size; larger values buffer more per request. */
	WEBHOOK_BODY_LIMIT: z.coerce
		.number()
		.int()
		.positive()
		.max(GITHUB_MAX_PAYLOAD_BYTES)
		.default(GITHUB_MAX_PAYLOAD_BYTES),
	/** When set, `/metrics` requires `Authorization: Bearer <token>`. `/health` stays public. */
	METRICS_TOKEN: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
	LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

	/**
	 * Optional read-only web dashboard. Off unless explicitly enabled AND given an
	 * OAuth client secret and a base URL, so a default deployment exposes no new
	 * surface at all. See `isDashboardConfigured`.
	 */
	DASHBOARD_ENABLED: z.preprocess(booleanish, z.boolean().default(false)),
	/** Public origin the dashboard is served from; the OAuth redirect is derived from it. */
	DASHBOARD_BASE_URL: z.preprocess(normalizePublicWebhookUrl, z.url().optional()),
	/** OAuth2 client secret from the Discord Developer Portal. Never sent to the browser. */
	DISCORD_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
	/** How long a dashboard sign-in lasts before it must be repeated. */
	DASHBOARD_SESSION_HOURS: z.coerce.number().int().positive().max(720).default(12),

	/** Optional Streaming activity target; the activity is skipped when unset. */
	PRESENCE_STREAM_URL: z.preprocess(emptyToUndefined, streamUrlSchema.optional()),
	/** Replaces the built-in rotation entirely when provided. */
	PRESENCE_ROTATION: z.preprocess(jsonArray, z.array(presenceEntrySchema).min(1).optional()),
	/** `{ "push": "<:push:123>" }` to swap Unicode icons for app emojis. */
	EMOJI_OVERRIDES: z.preprocess(jsonRecord, z.record(z.string(), z.string()).optional()),
	DEFAULT_LOCALE: z.preprocess(emptyToUndefined, z.enum(SUPPORTED_LOCALES).default("en")),
	DEFAULT_THEME: z.preprocess(emptyToUndefined, z.enum(THEME_IDS).default("default")),
	DEFAULT_DISPLAY_MODE: z.preprocess(emptyToUndefined, z.enum(DISPLAY_MODES).default("detailed")),
});

export type Env = z.infer<typeof envSchema>;

export type FullyConfiguredEnv = Env & {
	DISCORD_TOKEN: string;
	DISCORD_CLIENT_ID: string;
	MASTER_KEY: string;
	PUBLIC_WEBHOOK_URL: string;
};

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
	if (cached && source === process.env) return cached;
	const parsed = envSchema.safeParse(source);
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
			.join("\n");
		throw new Error(`Invalid environment variables:\n${issues}`);
	}
	if (source === process.env) cached = parsed.data;
	return parsed.data;
}

export function resetEnvCache(): void {
	cached = undefined;
}

/** JSON env vars degrade to unset rather than crashing boot, which otherwise hides operator typos. */
const LENIENT_JSON_KEYS = ["EMOJI_OVERRIDES", "PRESENCE_ROTATION"] as const;

export function envWarnings(env: Env, source: NodeJS.ProcessEnv = process.env): string[] {
	return LENIENT_JSON_KEYS.filter(
		(key) => typeof emptyToUndefined(source[key]) === "string" && env[key] === undefined,
	).map((key) => `${key} was set but could not be parsed as JSON — ignoring it`);
}

export function isFullyConfigured(env: Env): env is FullyConfiguredEnv {
	return Boolean(
		env.DISCORD_TOKEN && env.DISCORD_CLIENT_ID && env.MASTER_KEY && env.PUBLIC_WEBHOOK_URL,
	);
}

export type DashboardEnv = Env & {
	DASHBOARD_BASE_URL: string;
	DISCORD_CLIENT_SECRET: string;
	DISCORD_CLIENT_ID: string;
};

/**
 * The dashboard needs its own opt-in plus OAuth credentials. Anything missing keeps
 * it off rather than half-serving it, so a misconfiguration cannot expose a route
 * that skips sign-in.
 */
export function isDashboardConfigured(env: Env): env is DashboardEnv {
	return Boolean(
		env.DASHBOARD_ENABLED &&
			env.DASHBOARD_BASE_URL &&
			env.DISCORD_CLIENT_SECRET &&
			env.DISCORD_CLIENT_ID,
	);
}

export function missingDashboardKeys(env: Env): string[] {
	const missing: string[] = [];
	if (!env.DASHBOARD_ENABLED) missing.push("DASHBOARD_ENABLED");
	if (!env.DASHBOARD_BASE_URL) missing.push("DASHBOARD_BASE_URL");
	if (!env.DISCORD_CLIENT_SECRET) missing.push("DISCORD_CLIENT_SECRET");
	if (!env.DISCORD_CLIENT_ID) missing.push("DISCORD_CLIENT_ID");
	return missing;
}

export function missingConfigKeys(env: Env): string[] {
	const missing: string[] = [];
	if (!env.DISCORD_TOKEN) missing.push("DISCORD_TOKEN");
	if (!env.DISCORD_CLIENT_ID) missing.push("DISCORD_CLIENT_ID");
	if (!env.MASTER_KEY) missing.push("MASTER_KEY");
	if (!env.PUBLIC_WEBHOOK_URL) missing.push("PUBLIC_WEBHOOK_URL");
	return missing;
}

export function isPostgresUrl(url: string): boolean {
	return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

export function sqlitePathFromUrl(url: string): string {
	// file:///abs/path → /abs/path ; file:./rel → ./rel ; file:/abs → /abs
	const stripped = url.replace(/^file:\/\//, "").replace(/^file:/, "");
	if (stripped.startsWith("/") || /^[A-Za-z]:[\\/]/.test(stripped)) {
		return stripped;
	}
	// file:///C:/... on Windows already handled; bare relative paths stay relative
	return stripped.startsWith("//") ? stripped.slice(1) : stripped;
}
