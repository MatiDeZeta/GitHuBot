import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle as drizzleSqlite } from "drizzle-orm/node-sqlite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { isPostgresUrl, sqlitePathFromUrl } from "../config/env.js";
import { createPgRepository } from "./repository.pg.js";
import { createSqliteRepository } from "./repository.sqlite.js";
import * as pgSchema from "./schema.pg.js";
import * as sqliteSchema from "./schema.sqlite.js";
import type { RepoRepository } from "./types.js";

export interface DbHandle {
	repository: RepoRepository;
	close: () => Promise<void>;
	kind: "sqlite" | "postgres";
}

export function createDb(databaseUrl: string): DbHandle {
	if (isPostgresUrl(databaseUrl)) {
		const client = postgres(databaseUrl, { max: 10 });
		const db = drizzlePg(client, { schema: pgSchema });
		return {
			kind: "postgres",
			repository: createPgRepository(db),
			async close() {
				await client.end({ timeout: 5 });
			},
		};
	}

	const path = sqlitePathFromUrl(databaseUrl);
	mkdirSync(dirname(path), { recursive: true });
	const sqlite = new DatabaseSync(path);
	sqlite.exec("PRAGMA journal_mode = WAL;");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzleSqlite(sqlite, { schema: sqliteSchema });
	return {
		kind: "sqlite",
		repository: createSqliteRepository(db),
		async close() {
			sqlite.close();
		},
	};
}
