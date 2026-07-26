import { ActivityType } from "discord.js";
import { describe, expect, it } from "vitest";
import {
	INITIAL_PRESENCE,
	applyPlaceholders,
	buildPresenceActivities,
	defaultRotation,
	pluralize,
	presencePlaceholders,
	type PresenceStats,
} from "./presence.js";

const stats: PresenceStats = {
	trackedRepos: 1,
	servers: 2,
	eventsToday: 7,
	uptimeMs: 3_600_000,
	pingMs: 42,
};

describe("pluralize", () => {
	it("uses singular for one", () => {
		expect(pluralize(1, "tracked repo")).toBe("1 tracked repo");
		expect(pluralize(1, "server")).toBe("1 server");
	});

	it("uses plural otherwise", () => {
		expect(pluralize(0, "tracked repo")).toBe("0 tracked repos");
		expect(pluralize(3, "server")).toBe("3 servers");
	});
});

describe("applyPlaceholders", () => {
	it("substitutes known placeholders and leaves unknown ones intact", () => {
		const values = presencePlaceholders(stats);
		expect(applyPlaceholders("{repos} repos on {servers}", values)).toBe("1 repos on 2");
		expect(applyPlaceholders("{events} events", values)).toBe("7 events");
		expect(applyPlaceholders("{nope}", values)).toBe("{nope}");
	});

	it("formats uptime and ping", () => {
		const values = presencePlaceholders(stats);
		expect(values.uptime).toBe("1h 0m");
		expect(values.ping).toBe("42");
	});
});

describe("buildPresenceActivities", () => {
	it("builds the default lineup with live counts", () => {
		const activities = buildPresenceActivities(stats);

		expect(activities).toHaveLength(defaultRotation(stats).length);
		expect(activities[0]).toEqual({
			name: "1 tracked repo",
			type: ActivityType.Watching,
		});
		expect(activities[1]).toEqual({
			name: "2 servers",
			type: ActivityType.Watching,
		});
		expect(activities[2]).toMatchObject({
			type: ActivityType.Custom,
			state: "⚡ 7 events today",
		});
		expect(activities.some((activity) => activity.name === "/repo")).toBe(true);
	});

	it("honors a custom rotation and its placeholders", () => {
		const activities = buildPresenceActivities(stats, {
			rotation: [
				{ type: "listening", name: "{repos} repos" },
				{ type: "custom", name: "Custom Status", state: "up {uptime}" },
			],
		});

		expect(activities).toEqual([
			{ name: "1 repos", type: ActivityType.Listening },
			{ name: "Custom Status", type: ActivityType.Custom, state: "up 1h 0m" },
		]);
	});

	it("appends a Streaming activity only when a stream URL is configured", () => {
		const without = buildPresenceActivities(stats);
		expect(without.some((activity) => activity.type === ActivityType.Streaming)).toBe(false);

		const withStream = buildPresenceActivities(stats, {
			streamUrl: "https://twitch.tv/example",
		});
		const streaming = withStream.find((activity) => activity.type === ActivityType.Streaming);
		expect(streaming?.url).toBe("https://twitch.tv/example");
	});

	it("attaches the stream URL to custom rotations that ask for Streaming", () => {
		const [activity] = buildPresenceActivities(stats, {
			rotation: [{ type: "streaming", name: "live" }],
			streamUrl: "https://youtube.com/@example",
		});
		expect(activity).toEqual({
			name: "live",
			type: ActivityType.Streaming,
			url: "https://youtube.com/@example",
		});
	});
});

describe("INITIAL_PRESENCE", () => {
	it("starts online watching GitHub → Discord", () => {
		expect(INITIAL_PRESENCE.status).toBe("online");
		expect(INITIAL_PRESENCE.activities[0]).toMatchObject({
			name: "GitHub → Discord",
			type: ActivityType.Watching,
		});
	});
});
