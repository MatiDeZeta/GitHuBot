import { ChannelType, type Client } from "discord.js";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../config/logger.js";
import { EMPTY_FILTERS, type GuildSettings, type TrackedRepo } from "../db/types.js";
import { healthTransition, maybeAlert, resetAlertCooldowns, shouldAlert } from "./alerts.js";
import type { DispatchContext } from "./dispatch.js";

function repo(overrides: Partial<TrackedRepo> = {}): TrackedRepo {
	return {
		id: 1,
		guildId: "g1",
		owner: "acme",
		repo: "app",
		channelId: "c1",
		trackingId: "t1",
		encryptedSecret: "x",
		encryptedPreviousSecret: null,
		enabledEvents: ["push"],
		paused: false,
		displayMode: null,
		theme: null,
		locale: null,
		filters: EMPTY_FILTERS,
		eventRoutes: {},
		mentionRules: {},
		lastDeliveryAt: null,
		lastSuccessAt: null,
		lastErrorAt: null,
		lastError: null,
		observedFullName: null,
		deliveredCount: 0,
		failedCount: 0,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

const healthy = repo({ lastSuccessAt: new Date(2000), lastErrorAt: new Date(1000) });
const failing = repo({ lastSuccessAt: new Date(1000), lastErrorAt: new Date(2000) });
const failed = { status: "failed", error: "Missing Permissions" } as const;

describe("health transitions", () => {
	it("alerts on the first failure, not on every one after it", () => {
		expect(healthTransition(healthy, failed)).toBe("failing");
		expect(healthTransition(repo(), { status: "bad_channel", channelId: "c1" })).toBe("failing");
		expect(healthTransition(failing, failed)).toBeNull();
	});

	it("announces recovery once deliveries work again", () => {
		expect(healthTransition(failing, { status: "delivered" })).toBe("recovered");
		expect(healthTransition(healthy, { status: "delivered" })).toBeNull();
	});

	it("ignores outcomes that say nothing about the channel", () => {
		expect(healthTransition(healthy, { status: "filtered", reason: "branch" })).toBeNull();
		expect(healthTransition(failing, { status: "paused" })).toBeNull();
	});
});

describe("alert delivery", () => {
	afterEach(() => resetAlertCooldowns());

	it("collapses a burst of concurrent failures into one alert", () => {
		expect(shouldAlert("t1", "failing", 0)).toBe(true);
		expect(shouldAlert("t1", "failing", 60_000)).toBe(false);
		expect(shouldAlert("t1", "recovered", 60_000)).toBe(true);
		expect(shouldAlert("t1", "failing", 11 * 60_000)).toBe(true);
	});

	function context(sent: unknown[]): DispatchContext {
		const channel = {
			type: ChannelType.GuildText,
			guild: {},
			send: async (message: unknown) => sent.push(message),
		};
		return {
			client: { channels: { fetch: async () => channel } } as unknown as Client,
			repository: {} as DispatchContext["repository"],
			logger: createLogger({ LOG_LEVEL: "fatal", NODE_ENV: "test" }),
			defaults: { locale: "en", theme: "default", mode: "compact" },
		};
	}
	const guild = (alertChannelId: string | null): GuildSettings => ({
		guildId: "g1",
		locale: null,
		defaultTheme: null,
		defaultDisplayMode: null,
		alertChannelId,
	});
	const options = { locale: "en", theme: "default", mode: "compact" } as const;

	it("posts to the server's alert channel, never pinging anyone", async () => {
		const sent: { components: { toJSON(): unknown }[]; allowedMentions: unknown }[] = [];
		await maybeAlert(context(sent), healthy, guild("alerts"), failed, "c1", options);
		expect(sent).toHaveLength(1);
		const text = JSON.stringify(sent[0]?.components.map((c) => c.toJSON()));
		expect(text).toContain("Deliveries are failing");
		expect(text).toContain("Missing Permissions");
		expect(sent[0]?.allowedMentions).toEqual({ parse: [] });
	});

	it("stays quiet when the server has no alert channel", async () => {
		const sent: unknown[] = [];
		await maybeAlert(context(sent), healthy, guild(null), failed, "c1", options);
		expect(sent).toHaveLength(0);
	});
});
