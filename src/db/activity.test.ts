import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ENABLED_EVENTS } from "../config/events.js";
import { encryptSecret, parseMasterKey } from "../crypto/secrets.js";
import { createDb, type DbHandle, migrate } from "./index.js";

describe("delivery activity", () => {
	let dir: string;
	let db: DbHandle;

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "githubot-activity-"));
		const url = `file:${join(dir, "test.db")}`;
		await migrate(url);
		db = createDb(url);
		const key = parseMasterKey(randomBytes(32).toString("hex"));
		await db.repository.ensureGuild("g1");
		for (const repo of ["one", "two"]) {
			await db.repository.addRepo({
				guildId: "g1",
				owner: "acme",
				repo,
				channelId: "c1",
				trackingId: `track-${repo}`,
				encryptedSecret: encryptSecret("s", key),
				enabledEvents: [...DEFAULT_ENABLED_EVENTS],
			});
		}
	});

	afterEach(async () => {
		await db.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns one fixed-width bucket per day, oldest first", async () => {
		await db.repository.tryRecordDelivery("d1", "track-one");
		await db.repository.tryRecordDelivery("d2", "track-one");
		await db.repository.tryRecordDelivery("d3", "track-two");

		const activity = await db.repository.activityByDay(["track-one", "track-two"], 7);
		const one = activity.get("track-one");
		const two = activity.get("track-two");

		expect(one).toHaveLength(7);
		expect(two).toHaveLength(7);
		// Everything just written lands in today's bucket, which is last.
		expect(one?.[6]).toBe(2);
		expect(two?.[6]).toBe(1);
		expect(one?.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
	});

	it("zero-fills a repository with no deliveries", async () => {
		const activity = await db.repository.activityByDay(["track-one"], 7);
		expect(activity.get("track-one")).toEqual([0, 0, 0, 0, 0, 0, 0]);
	});

	it("returns an empty map for no tracking ids", async () => {
		expect((await db.repository.activityByDay([], 7)).size).toBe(0);
	});

	it("never mixes one repository's deliveries into another", async () => {
		for (let i = 0; i < 5; i++) await db.repository.tryRecordDelivery(`x${i}`, "track-one");
		const activity = await db.repository.activityByDay(["track-one", "track-two"], 7);
		expect(activity.get("track-one")?.reduce((a, b) => a + b, 0)).toBe(5);
		expect(activity.get("track-two")?.reduce((a, b) => a + b, 0)).toBe(0);
	});
});
