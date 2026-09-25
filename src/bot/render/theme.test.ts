import { describe, expect, it } from "vitest";
import { ACCENT_KEYS } from "../../design/tokens.js";
import { resolveAccent, THEME_IDS } from "./theme.js";

describe("language theme", () => {
	const ts = { theme: "language" as const, language: "TypeScript" };
	const plain = { theme: "default" as const };

	it("colours informational events with the repository's language", () => {
		expect(resolveAccent("push", ts)).toBe(0x3178c6);
		expect(resolveAccent("prOpen", ts)).toBe(0x3178c6);
	});

	it("keeps status colours, so a failure is still red", () => {
		expect(resolveAccent("workflowFailure", ts)).toBe(resolveAccent("workflowFailure", plain));
		expect(resolveAccent("securityCritical", ts)).toBe(resolveAccent("securityCritical", plain));
		expect(resolveAccent("prMerged", ts)).toBe(resolveAccent("prMerged", plain));
	});

	it("falls back to the default palette for an unknown language", () => {
		expect(resolveAccent("push", { theme: "language", language: "Not A Real Language" })).toBe(
			resolveAccent("push", plain),
		);
	});
});

describe("palettes", () => {
	it("every theme colours success and failure differently", () => {
		for (const theme of THEME_IDS) {
			if (theme === "mono") continue;
			expect(
				resolveAccent("workflowSuccess", { theme }),
				`${theme} makes success and failure the same colour`,
			).not.toBe(resolveAccent("workflowFailure", { theme }));
		}
	});

	it("every theme defines every accent", () => {
		for (const theme of THEME_IDS) {
			for (const accent of ACCENT_KEYS) {
				const color = resolveAccent(accent, { theme, language: "TypeScript" });
				expect(
					Number.isInteger(color) && color >= 0 && color <= 0xffffff,
					`${theme}.${accent}`,
				).toBe(true);
			}
		}
	});

	it("knows GitHub's full language list", () => {
		const lang = { theme: "language" as const };
		expect(resolveAccent("push", { ...lang, language: "Jupyter Notebook" })).toBe(0xda5b0b);
		expect(resolveAccent("push", { ...lang, language: "Gleam" })).toBe(0xffaff3);
	});

	it("lifts a near-black language colour so the accent bar stays visible", () => {
		const lua = resolveAccent("push", { theme: "language", language: "Lua" });
		expect(lua).not.toBe(0x000080);
		// Still recognisably blue: the blue channel dominates.
		expect(lua & 0xff).toBeGreaterThan((lua >> 16) & 0xff);
	});
});
