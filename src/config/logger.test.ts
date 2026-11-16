import { describe, expect, it } from "vitest";
import { serializeError } from "./logger.js";

describe("logged errors", () => {
	it("drops the request a Discord API error carries, which is the message itself", () => {
		const err = Object.assign(new Error("Missing Access"), {
			code: 50001,
			status: 403,
			requestBody: { json: { components: [{ content: "private issue text" }] } },
		});
		const logged = serializeError(err) as Record<string, unknown>;
		expect(logged.message).toBe("Missing Access");
		expect(logged.code).toBe(50001);
		expect(logged).not.toHaveProperty("requestBody");
		expect(JSON.stringify(logged)).not.toContain("private issue text");
		// The caller's error object is not what gets edited.
		expect(err.requestBody).toBeDefined();
	});
});
