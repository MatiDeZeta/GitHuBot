import { describe, expect, it } from "vitest";
import { resolveAccent } from "./theme.js";

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
		expect(resolveAccent("push", { theme: "language", language: "Brainfuck" })).toBe(
			resolveAccent("push", plain),
		);
	});
});
