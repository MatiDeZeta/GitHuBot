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

describe("server lifecycle", () => {
	let dir: string;
	let db: DbHandle;

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "githubot-guilds-"));
		const url = `file:${join(dir, "test.db")}`;
		await migrate(url);
		db = createDb(url);
		await db.repository.addRepo({
			guildId: "gone",
			owner: "acme",
			repo: "app",
			channelId: "c1",
			trackingId: "t-gone",
			encryptedSecret: "x",
			enabledEvents: [...DEFAULT_ENABLED_EVENTS],
		});
		await db.repository.ensureGuild("stays");
		await db.repository.tryRecordDelivery("d1", "t-gone");
	});

	afterEach(async () => {
		await db.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("keeps the first removal date, so restarts never reset the grace period", async () => {
		await db.repository.setGuildLeft("gone", new Date(1_000));
		await db.repository.setGuildLeft("gone", new Date(9_000_000_000_000));
		// Purging with a cutoff between the two dates proves the first one stuck.
		expect(await db.repository.purgeGuildsLeftBefore(new Date(2_000))).toBe(1);
	});

	it("purges a departed server with its repositories and delivery records", async () => {
		await db.repository.setGuildLeft("gone", new Date(1_000));
		expect(await db.repository.purgeGuildsLeftBefore(new Date())).toBe(1);
		expect(await db.repository.getRepo("gone", "acme", "app")).toBeNull();
		expect(await db.repository.tryRecordDelivery("d1", "t-gone")).toBe(true);
		expect(await db.repository.listGuildIds()).toEqual(["stays"]);
	});

	it("cancels the purge when the bot is invited back", async () => {
		await db.repository.setGuildLeft("gone", new Date(1_000));
		await db.repository.setGuildLeft("gone", null);
		expect(await db.repository.purgeGuildsLeftBefore(new Date())).toBe(0);
	});

	it("deletes a removed repository's delivery records immediately", async () => {
		await db.repository.removeRepo("gone", "acme", "app");
		expect(await db.repository.tryRecordDelivery("d1", "t-gone")).toBe(true);
	});
});

describe("delivery log", () => {
	let dir: string;
	let url: string;
	let db: DbHandle;

	const entry = (
		trackingId: string,
		outcome: "delivered" | "failed" | "filtered",
		event = "push",
	) =>
		db.repository.recordDeliveryLog({
			trackingId,
			deliveryId: randomBytes(6).toString("hex"),
			event,
			action: null,
			outcome,
			detail: outcome === "failed" ? "Missing Access" : null,
		});

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "githubot-log-"));
		url = `file:${join(dir, "test.db")}`;
		await migrate(url);
		db = createDb(url);
		const secret = encryptSecret("s", parseMasterKey(randomBytes(32).toString("hex")));
		for (const [guildId, repo, trackingId] of [
			["g1", "app", "t1"],
			["g1", "docs", "t2"],
			["g2", "other", "t3"],
		] as const) {
			await db.repository.addRepo({
				guildId,
				owner: "acme",
				repo,
				channelId: "c1",
				trackingId,
				encryptedSecret: secret,
				enabledEvents: [...DEFAULT_ENABLED_EVENTS],
			});
		}
	});

	afterEach(async () => {
		await db.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("lists newest first, only for the repositories asked about", async () => {
		await entry("t1", "delivered", "push");
		await entry("t2", "failed", "issues");
		await entry("t3", "delivered", "release");

		const log = await db.repository.listDeliveryLog(["t1", "t2"], { limit: 10 });
		expect(log.map((row) => row.event)).toEqual(["issues", "push"]);
		expect(log[0]?.detail).toBe("Missing Access");
		expect(await db.repository.listDeliveryLog([], { limit: 10 })).toEqual([]);
	});

	it("pages backwards by id and filters by outcome", async () => {
		for (let i = 0; i < 5; i++) await entry("t1", i % 2 === 0 ? "delivered" : "failed");

		const first = await db.repository.listDeliveryLog(["t1"], { limit: 2 });
		const second = await db.repository.listDeliveryLog(["t1"], {
			limit: 2,
			before: first.at(-1)?.id,
		});
		expect(first.length).toBe(2);
		expect(second.length).toBe(2);
		expect(second[0]?.id).toBeLessThan(first[1]?.id ?? 0);

		const failed = await db.repository.listDeliveryLog(["t1"], { limit: 10, outcome: "failed" });
		expect(failed.map((row) => row.outcome)).toEqual(["failed", "failed"]);
	});

	it("counts outcomes since a point in time", async () => {
		await entry("t1", "delivered");
		await entry("t1", "delivered");
		await entry("t2", "filtered");
		await entry("t3", "failed");

		expect(await db.repository.deliveryOutcomeCounts(["t1", "t2"], new Date(0))).toEqual({
			delivered: 2,
			filtered: 1,
		});
		expect(
			await db.repository.deliveryOutcomeCounts(["t1"], new Date(Date.now() + 60_000)),
		).toEqual({});
	});

	it("clamps an oversized detail", async () => {
		await db.repository.recordDeliveryLog({
			trackingId: "t1",
			deliveryId: "d",
			event: "push",
			action: null,
			outcome: "failed",
			detail: "x".repeat(5_000),
		});
		const [row] = await db.repository.listDeliveryLog(["t1"], { limit: 1 });
		expect(row?.detail?.length).toBeLessThanOrEqual(500);
	});

	it("is pruned with the ledger and deleted with its repository", async () => {
		await entry("t1", "delivered");
		await entry("t2", "delivered");
		const raw = new Database(url.replace("file:", ""));
		raw.prepare("UPDATE delivery_log SET created_at = 1000 WHERE tracking_id = 't1'").run();
		raw.close();

		await db.repository.pruneDeliveries(new Date(2_000));
		expect(await db.repository.listDeliveryLog(["t1"], { limit: 10 })).toEqual([]);
		expect((await db.repository.listDeliveryLog(["t2"], { limit: 10 })).length).toBe(1);

		await db.repository.removeRepo("g1", "acme", "docs");
		expect(await db.repository.listDeliveryLog(["t2"], { limit: 10 })).toEqual([]);
	});

	it("is deleted when a departed server is purged", async () => {
		await entry("t3", "delivered");
		await db.repository.setGuildLeft("g2", new Date(1_000));
		await db.repository.purgeGuildsLeftBefore(new Date());
		expect(await db.repository.listDeliveryLog(["t3"], { limit: 10 })).toEqual([]);
	});
});
