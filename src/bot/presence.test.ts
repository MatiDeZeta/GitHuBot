import { ActivityType } from "discord.js";
import { describe, expect, it } from "vitest";
import {
	INITIAL_PRESENCE,
	buildPresenceActivities,
	pluralize,
} from "./presence.js";

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

describe("buildPresenceActivities", () => {
	it("builds Watching/Listening/Custom lineup with live counts", () => {
		const activities = buildPresenceActivities({ trackedRepos: 1, servers: 2 });

		expect(activities).toHaveLength(5);
		expect(activities[0]).toEqual({
			name: "1 tracked repo",
			type: ActivityType.Watching,
		});
		expect(activities[1]).toEqual({
			name: "2 servers",
			type: ActivityType.Watching,
		});
		expect(activities[2]).toMatchObject({
			name: "GitHub → Discord",
			type: ActivityType.Watching,
		});
		expect(activities[3]).toMatchObject({
			name: "/repo",
			type: ActivityType.Listening,
		});
		expect(activities[4]).toEqual({
			name: "Custom Status",
			type: ActivityType.Custom,
			state: "Beautiful changelogs · no GitHub token",
		});
	});

	it("pluralizes tracked repos when count is not one", () => {
		const [repos] = buildPresenceActivities({ trackedRepos: 4, servers: 1 });
		expect(repos?.name).toBe("4 tracked repos");
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
