import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ENABLED_EVENTS } from "../config/events.js";
import { encryptSecret, parseMasterKey } from "../crypto/secrets.js";
import { createDb, type DbHandle, migrate } from "./index.js";

describe("tracked repository lookups", () => {
	let dir: string;
	let db: DbHandle;

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "githubot-repo-"));
		const url = `file:${join(dir, "test.db")}`;
		await migrate(url);
		db = createDb(url);
		await db.repository.addRepo({
			guildId: "g1",
			owner: "Acme",
			repo: "App",
			channelId: "c1",
			trackingId: "track-1",
			encryptedSecret: encryptSecret("s", parseMasterKey(randomBytes(32).toString("hex"))),
			enabledEvents: [...DEFAULT_ENABLED_EVENTS],
		});
	});

	afterEach(async () => {
		await db.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("matches owner and repository names case-insensitively, like GitHub", async () => {
		const found = await db.repository.getRepo("g1", "acme", "app");
		// The stored casing is kept for display.
		expect(found?.owner).toBe("Acme");
		expect(found?.repo).toBe("App");

		expect(await db.repository.setPaused("g1", "ACME", "app", true)).not.toBeNull();
		expect(await db.repository.removeRepo("g1", "acme", "APP")).not.toBeNull();
		expect(await db.repository.getRepo("g1", "Acme", "App")).toBeNull();
	});

	it("keeps lookups scoped to the guild", async () => {
		expect(await db.repository.getRepo("g2", "acme", "app")).toBeNull();
	});
});

describe("delivery ledger", () => {
	let dir: string;
	let url: string;
	let db: DbHandle;

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "githubot-ledger-"));
		url = `file:${join(dir, "test.db")}`;
		await migrate(url);
		db = createDb(url);
	});

	afterEach(async () => {
		await db.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("prunes only records older than the cutoff", async () => {
		await db.repository.tryRecordDelivery("old", "t1");
		await db.repository.tryRecordDelivery("new", "t1");
		const raw = new Database(join(dir, "test.db"));
		raw
			.prepare("UPDATE deliveries SET created_at = ? WHERE delivery_id = 'old'")
			.run(Date.now() - 40 * 86_400_000);
		raw.close();

		const removed = await db.repository.pruneDeliveries(new Date(Date.now() - 30 * 86_400_000));

		expect(removed).toBe(1);
		// A pruned id is new again; a kept one is still a duplicate.
		expect(await db.repository.tryRecordDelivery("old", "t1")).toBe(true);
		expect(await db.repository.tryRecordDelivery("new", "t1")).toBe(false);
	});

	it("releases a recorded delivery so it can be processed again", async () => {
		await db.repository.tryRecordDelivery("d1", "t1");
		await db.repository.releaseDelivery("d1");
		expect(await db.repository.tryRecordDelivery("d1", "t1")).toBe(true);
	});
});

describe("migrations", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "githubot-migrate-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("rolls back a migration that fails part-way, so a retry starts clean", async () => {
		const root = join(dir, "drizzle");
		mkdirSync(join(root, "sqlite"), { recursive: true });
		writeFileSync(join(root, "sqlite", "0000_ok.sql"), "CREATE TABLE a (id integer);");
		writeFileSync(
			join(root, "sqlite", "0001_broken.sql"),
			"CREATE TABLE b (id integer);\nALTER TABLE missing ADD COLUMN x text;",
		);
		const url = `file:${join(dir, "test.db")}`;

		await expect(migrate(url, root)).rejects.toThrow(/missing/);

		const raw = new Database(join(dir, "test.db"));
		const tables = raw
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
			.all()
			.map((row) => (row as { name: string }).name);
		const applied = raw
			.prepare("SELECT id FROM __migrations")
			.all()
			.map((row) => (row as { id: string }).id);
		raw.close();

		// `b` was created by the failing file and must not survive it.
		expect(tables).toContain("a");
		expect(tables).not.toContain("b");
		expect(applied).toEqual(["0000_ok.sql"]);
	});
});
