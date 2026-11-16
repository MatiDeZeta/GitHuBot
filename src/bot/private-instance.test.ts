import { RESTJSONErrorCodes } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../config/logger.js";
import { leaveIfOwnerAbsent } from "./private-instance.js";

const OWNER = "111111111111111111";
const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as Logger;

function guild(fetch: () => Promise<unknown>, ownerId = "999999999999999999") {
	const leave = vi.fn(async () => undefined);
	const value = { id: "222222222222222222", ownerId, members: { fetch }, leave };
	return { value: value as unknown as Parameters<typeof leaveIfOwnerAbsent>[0], leave };
}

const unknownMember = () =>
	Promise.reject(
		Object.assign(new Error("Unknown Member"), { code: RESTJSONErrorCodes.UnknownMember }),
	);

describe("private instance", () => {
	it("does nothing unless the instance is locked to one account", async () => {
		const { value, leave } = guild(unknownMember);
		expect(await leaveIfOwnerAbsent(value, undefined, logger)).toBe(false);
		expect(leave).not.toHaveBeenCalled();
	});

	it("stays in a server its owner is a member of, or owns", async () => {
		const member = guild(async () => ({ id: OWNER }));
		expect(await leaveIfOwnerAbsent(member.value, OWNER, logger)).toBe(false);
		expect(member.leave).not.toHaveBeenCalled();

		const owned = guild(unknownMember, OWNER);
		expect(await leaveIfOwnerAbsent(owned.value, OWNER, logger)).toBe(false);
		expect(owned.leave).not.toHaveBeenCalled();
	});

	it("leaves a server Discord says its owner is not in", async () => {
		const { value, leave } = guild(unknownMember);
		expect(await leaveIfOwnerAbsent(value, OWNER, logger)).toBe(true);
		expect(leave).toHaveBeenCalledOnce();
	});

	it("stays when the check itself fails, rather than guess", async () => {
		const { value, leave } = guild(() => Promise.reject(new Error("socket hang up")));
		expect(await leaveIfOwnerAbsent(value, OWNER, logger)).toBe(false);
		expect(leave).not.toHaveBeenCalled();
	});
});
