import { describe, expect, it } from "vitest";
import { repositoryMismatch } from "./repository.js";

const tracked = { owner: "Acme", repo: "App" };
const from = (fullName: unknown) => ({ repository: { full_name: fullName } });

describe("repositoryMismatch", () => {
	it("is null when GitHub names the tracked repository, in any casing", () => {
		expect(repositoryMismatch(tracked, from("Acme/App"))).toBeNull();
		expect(repositoryMismatch(tracked, from("acme/app"))).toBeNull();
	});

	it("returns the reported name when it differs", () => {
		expect(repositoryMismatch(tracked, from("acme/app-renamed"))).toBe("acme/app-renamed");
		expect(repositoryMismatch(tracked, from("new-owner/App"))).toBe("new-owner/App");
	});

	it("learns nothing from a payload that names no repository", () => {
		expect(repositoryMismatch(tracked, {})).toBeUndefined();
		expect(repositoryMismatch(tracked, null)).toBeUndefined();
		expect(repositoryMismatch(tracked, { repository: "acme/app" })).toBeUndefined();
	});

	it("ignores a name that is not an owner/repo slug", () => {
		expect(repositoryMismatch(tracked, from("<b>acme</b>/app"))).toBeUndefined();
		expect(repositoryMismatch(tracked, from("acme"))).toBeUndefined();
		expect(repositoryMismatch(tracked, from(42))).toBeUndefined();
	});
});
