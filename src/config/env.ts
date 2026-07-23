import { z } from "zod";

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

const envSchema = z.object({
	DISCORD_TOKEN: z.string().min(1),
	DISCORD_CLIENT_ID: z.string().min(1),
	DISCORD_GUILD_ID: z.string().optional(),
	MASTER_KEY: masterKeySchema,
	PUBLIC_WEBHOOK_URL: z.url().transform((url) => url.replace(/\/$/, "")),
	DATABASE_URL: z.string().default("file:./data/githubot.db"),
	PORT: z.coerce.number().int().positive().default(3000),
	HOST: z.string().default("0.0.0.0"),
	LOG_LEVEL: z
		.enum(["fatal", "error", "warn", "info", "debug", "trace"])
		.default("info"),
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

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

export function isPostgresUrl(url: string): boolean {
	return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

export function sqlitePathFromUrl(url: string): string {
	return url.replace(/^file:/, "");
}
