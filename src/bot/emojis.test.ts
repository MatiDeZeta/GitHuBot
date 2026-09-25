import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ICON_KEYS } from "../design/tokens.js";
import { EMOJI_DIR, type EmojiRest, syncApplicationEmojis } from "./emojis.js";
import {
	APP_EMOJI_PREFIX,
	applyApplicationEmojis,
	applyIconOverrides,
	icon,
	resetIconOverrides,
} from "./render/icons.js";

/** Records calls and answers like Discord's application emoji endpoints. */
function fakeRest(existing: { id: string; name: string }[]) {
	const calls: string[] = [];
	let next = 1000;
	const rest: EmojiRest = {
		async get() {
			return { items: existing };
		},
		async post(_route, { body }) {
			const { name } = body as { name: string };
			calls.push(`create ${name}`);
			if (name === `${APP_EMOJI_PREFIX}broken`) throw new Error("Invalid Form Body");
			return { id: String(next++), name };
		},
		async delete(route) {
			calls.push(`delete ${route.split("/").pop()}`);
			return undefined;
		},
	};
	return { rest, calls };
}

describe("application emoji icons", () => {
	afterEach(() => resetIconOverrides());

	it("switches an icon to the bot's gh_* emoji", () => {
		const applied = applyApplicationEmojis([
			{ id: "1", name: "gh_merged" },
			{ id: "2", name: "gh_star", animated: true },
			{ id: "3", name: "party_parrot" },
			{ id: "4", name: "gh_notAnIcon" },
		]);
		expect(applied).toEqual(["merged", "star"]);
		expect(icon("merged")).toBe("<:gh_merged:1>");
		expect(icon("star")).toBe("<a:gh_star:2>");
	});

	it("lets EMOJI_OVERRIDES win over detected emojis", () => {
		applyIconOverrides({ merged: "<:custom:9>" });
		applyApplicationEmojis([{ id: "1", name: "gh_merged" }]);
		expect(icon("merged")).toBe("<:custom:9>");
	});
});

describe("emoji sync", () => {
	it("uploads only the icons the application does not have yet", async () => {
		const { rest, calls } = fakeRest([{ id: "1", name: "gh_merged" }]);
		const result = await syncApplicationEmojis(rest, "app");
		expect(result.unchanged).toBe(1);
		expect(calls).not.toContain("create gh_merged");
		expect(result.created.length).toBe(
			readdirSync(EMOJI_DIR).filter((f) => f.endsWith(".png")).length - 1,
		);
		expect(result.emojis.map((emoji) => emoji.name)).toContain("gh_merged");
	});

	it("re-uploads existing icons only when asked to replace them", async () => {
		const { rest, calls } = fakeRest([{ id: "1", name: "gh_merged" }]);
		const result = await syncApplicationEmojis(rest, "app", { replace: true });
		expect(calls).toContain("delete 1");
		expect(result.replaced).toContain("gh_merged");
	});
});

describe("bundled icon artwork", () => {
	const files = readdirSync(EMOJI_DIR).filter((file) => file.endsWith(".png"));

	it("covers every icon except the GitHub mark, which stays Unicode", () => {
		const covered = files.map((file) => file.slice(APP_EMOJI_PREFIX.length, -".png".length));
		expect(new Set(covered)).toEqual(new Set(ICON_KEYS.filter((key) => key !== "github")));
	});

	it("fits Discord's emoji rules: 2–32 character names, under 256 KiB", () => {
		for (const file of files) {
			const name = file.slice(0, -".png".length);
			expect(name, file).toMatch(/^[A-Za-z0-9_]{2,32}$/);
			expect(statSync(join(EMOJI_DIR, file)).size, file).toBeLessThan(256 * 1024);
		}
	});
});
