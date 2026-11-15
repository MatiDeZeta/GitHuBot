import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS } from "../db/types.js";
import { applyFilters, branchAllowed, isIgnoredActor, matchesGlob } from "./filters.js";

describe("matchesGlob", () => {
	it.each([
		["main", "main", true],
		["main", "MAIN", true],
		["main", "maint", false],
		["release/*", "release/1.2", true],
		["release/*", "release/", true],
		["release/*", "releases/1.2", false],
		["*", "anything", true],
		["*", "", true],
		["*-wip", "feature-wip", true],
		["*-wip", "feature-wip-2", false],
		["feat/*/done", "feat/a/b/done", true],
		["v?.x", "v1.x", true],
		["v?.x", "v10.x", false],
		["a*b*c", "a--b--c", true],
		["a*b*c", "a--c--b", false],
		["**", "x", true],
		["", "main", false],
		["   ", "main", false],
	])("%j against %j is %s", (pattern, value, expected) => {
		expect(matchesGlob(pattern, value)).toBe(expected);
	});

	it("treats regex metacharacters as literals", () => {
		expect(matchesGlob("release-1.0", "release-1x0")).toBe(false);
		expect(matchesGlob("fix(scope)+[x]", "fix(scope)+[x]")).toBe(true);
		expect(matchesGlob("a|b", "a")).toBe(false);
	});

	it("stays fast on a pattern that makes a regex backtrack", () => {
		// Compiled to a regex, a 7-wildcard version of this ran for over two minutes
		// against 120 characters.
		const pattern = `${"*a".repeat(12)}*b`;
		const value = `${"a".repeat(250)}c`;
		const started = performance.now();
		expect(matchesGlob(pattern, value)).toBe(false);
		expect(performance.now() - started).toBeLessThan(200);
	});
});

describe("applyFilters", () => {
	const push = (ref: string, login = "ada") => ({ ref, sender: { login, type: "User" } });

	it("delivers everything when no filter is set", () => {
		expect(applyFilters(EMPTY_FILTERS, "push", push("refs/heads/main")).deliver).toBe(true);
	});

	it("lets an exclude win over an include", () => {
		const filters = { ...EMPTY_FILTERS, branchInclude: ["release/*"], branchExclude: ["*-rc"] };
		expect(branchAllowed(filters, "release/1.0")).toBe(true);
		expect(branchAllowed(filters, "release/1.0-rc")).toBe(false);
		expect(branchAllowed(filters, "main")).toBe(false);
	});

	it("reports which filter dropped a delivery", () => {
		const filters = { ...EMPTY_FILTERS, branchInclude: ["main"] };
		expect(applyFilters(filters, "push", push("refs/heads/dev"))).toEqual({
			deliver: false,
			reason: "branch",
		});
	});

	it("only applies label filters to events that carry labels", () => {
		const filters = { ...EMPTY_FILTERS, labels: ["bug"] };
		expect(applyFilters(filters, "push", push("refs/heads/main")).deliver).toBe(true);
		const issue = (name: string) => ({ issue: { labels: [{ name }] } });
		expect(applyFilters(filters, "issues", issue("Bug")).deliver).toBe(true);
		expect(applyFilters(filters, "issues", issue("docs"))).toEqual({
			deliver: false,
			reason: "label",
		});
	});

	it("matches ignored actors by name, glob and the `bot` keyword", () => {
		const bot = { sender: { login: "renovate[bot]", type: "Bot" } };
		expect(isIgnoredActor(["bot"], bot)).toBe(true);
		expect(isIgnoredActor(["renovate*"], bot)).toBe(true);
		expect(isIgnoredActor(["ADA"], { sender: { login: "ada" } })).toBe(true);
		expect(isIgnoredActor(["bot"], { sender: { login: "ada", type: "User" } })).toBe(false);
	});
});
