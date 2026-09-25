import { describe, expect, it } from "vitest";
import { eventTime } from "./time.js";

describe("eventTime", () => {
	it("reads the time the event happened, not when it arrived", () => {
		const at = eventTime("issues", { issue: { updated_at: "2026-09-01T10:00:00Z" } });
		expect(at?.toISOString()).toBe("2026-09-01T10:00:00.000Z");
	});

	it("uses the push time, which GitHub sends as Unix seconds", () => {
		const at = eventTime("push", { repository: { pushed_at: 1_788_000_000 } });
		expect(at?.getTime()).toBe(1_788_000_000_000);
	});

	it("falls through to the next candidate when the first is missing", () => {
		const at = eventTime("workflow_job", {
			workflow_job: { completed_at: null, started_at: "2026-09-02T08:00:00Z" },
		});
		expect(at?.toISOString()).toBe("2026-09-02T08:00:00.000Z");
	});

	it("ignores missing, malformed and far-future times", () => {
		expect(eventTime("issues", {})).toBeUndefined();
		expect(eventTime("issues", { issue: { updated_at: "not a date" } })).toBeUndefined();
		expect(eventTime("issues", { issue: { updated_at: "2999-01-01T00:00:00Z" } })).toBeUndefined();
		expect(eventTime("gollum", { pages: [] })).toBeUndefined();
	});
});
