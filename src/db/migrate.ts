import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import postgres from "postgres";
import { isPostgresUrl, sqlitePathFromUrl } from "../config/env.js";

const here = dirname(fileURLToPath(import.meta.url));
/** Contains `sqlite/` and `pg/`. Overridable so tests can apply their own files. */
const DEFAULT_MIGRATIONS_ROOT = join(here, "../..", "drizzle");

function applySqliteMigrations(databaseUrl: string, migrationsRoot: string): void {
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

		const migrationsDir = join(migrationsRoot, "sqlite");
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

		// Each file and its bookkeeping row commit together. Without the transaction a
		// statement failing mid-file left the earlier ones applied but the file
		// unrecorded, so every later boot re-ran it and failed on the half-done part.
		const record = db.prepare("INSERT INTO __migrations (id, applied_at) VALUES (?, ?)");
		const applyFile = db.transaction((file: string, sql: string) => {
			db.exec(sql);
			record.run(file, Date.now());
		});

		try {
			for (const file of files) {
				if (applied.has(file)) continue;
				applyFile(file, readFileSync(join(migrationsDir, file), "utf8"));
			}
		} finally {
			db.close();
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`SQLite open/migrate failed for path "${path}": ${message}`, {
			cause: err,
		});
	}
}

async function applyPgMigrations(databaseUrl: string, migrationsRoot: string): Promise<void> {
	const sql = postgres(databaseUrl, { max: 1 });
	try {
		await applyPgFiles(sql, migrationsRoot);
	} finally {
		await sql.end({ timeout: 5 });
	}
}

async function applyPgFiles(sql: postgres.Sql, migrationsRoot: string): Promise<void> {
	await sql`
		CREATE TABLE IF NOT EXISTS __migrations (
			id TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`;

	const migrationsDir = join(migrationsRoot, "pg");
	if (!existsSync(migrationsDir)) return;

	const files = readdirSync(migrationsDir)
		.filter((f) => f.endsWith(".sql"))
		.sort();

	const appliedRows = await sql<{ id: string }[]>`SELECT id FROM __migrations`;
	const applied = new Set(appliedRows.map((r) => r.id));

	for (const file of files) {
		if (applied.has(file)) continue;
		const content = readFileSync(join(migrationsDir, file), "utf8");
		// Same reasoning as SQLite: a file and its record commit or roll back together.
		await sql.begin(async (tx) => {
			await tx.unsafe(content);
			await tx.unsafe("INSERT INTO __migrations (id, applied_at) VALUES ($1, NOW())", [file]);
		});
	}
}

export async function migrate(
	databaseUrl: string,
	migrationsRoot: string = DEFAULT_MIGRATIONS_ROOT,
): Promise<void> {
	if (isPostgresUrl(databaseUrl)) {
		await applyPgMigrations(databaseUrl, migrationsRoot);
		return;
	}
	applySqliteMigrations(databaseUrl, migrationsRoot);
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
