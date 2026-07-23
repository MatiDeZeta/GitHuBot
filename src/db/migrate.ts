import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import postgres from "postgres";
import { isPostgresUrl, sqlitePathFromUrl } from "../config/env.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

function applySqliteMigrations(databaseUrl: string): void {
	const path = sqlitePathFromUrl(databaseUrl);
	try {
		mkdirSync(dirname(path), { recursive: true });
		const db = new Database(path);
		db.pragma("foreign_keys = ON");
		db.exec(`
		CREATE TABLE IF NOT EXISTS __migrations (
			id TEXT PRIMARY KEY,
			applied_at INTEGER NOT NULL
		);
	`);

		const migrationsDir = join(root, "drizzle", "sqlite");
		if (!existsSync(migrationsDir)) {
			db.close();
			return;
		}

		const files = readdirSync(migrationsDir)
			.filter((f) => f.endsWith(".sql"))
			.sort();

		const applied = new Set(
			db
				.prepare("SELECT id FROM __migrations")
				.all()
				.map((row) => (row as { id: string }).id),
		);

		for (const file of files) {
			if (applied.has(file)) continue;
			const sql = readFileSync(join(migrationsDir, file), "utf8");
			db.exec(sql);
			db.prepare("INSERT INTO __migrations (id, applied_at) VALUES (?, ?)").run(
				file,
				Date.now(),
			);
		}
		db.close();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`SQLite open/migrate failed for path "${path}": ${message}`, {
			cause: err,
		});
	}
}

async function applyPgMigrations(databaseUrl: string): Promise<void> {
	const sql = postgres(databaseUrl, { max: 1 });
	await sql`
		CREATE TABLE IF NOT EXISTS __migrations (
			id TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`;

	const migrationsDir = join(root, "drizzle", "pg");
	if (!existsSync(migrationsDir)) {
		await sql.end({ timeout: 5 });
		return;
	}

	const files = readdirSync(migrationsDir)
		.filter((f) => f.endsWith(".sql"))
		.sort();

	const appliedRows = await sql<{ id: string }[]>`SELECT id FROM __migrations`;
	const applied = new Set(appliedRows.map((r) => r.id));

	for (const file of files) {
		if (applied.has(file)) continue;
		const content = readFileSync(join(migrationsDir, file), "utf8");
		await sql.unsafe(content);
		await sql`INSERT INTO __migrations (id, applied_at) VALUES (${file}, NOW())`;
	}
	await sql.end({ timeout: 5 });
}

export async function migrate(databaseUrl: string): Promise<void> {
	if (isPostgresUrl(databaseUrl)) {
		await applyPgMigrations(databaseUrl);
		return;
	}
	applySqliteMigrations(databaseUrl);
}

const isDirectRun = process.argv[1]
	? fileURLToPath(import.meta.url) === process.argv[1] ||
		process.argv[1].endsWith("migrate.ts") ||
		process.argv[1].endsWith("migrate.js")
	: false;

if (isDirectRun) {
	const url = process.env.DATABASE_URL ?? "file:./data/githubot.db";
	migrate(url)
		.then(() => {
			console.log("Migrations applied.");
		})
		.catch((err) => {
			console.error(err);
			process.exit(1);
		});
}
