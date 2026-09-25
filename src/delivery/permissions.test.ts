import { ChannelType, type Client, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { describe, expect, it } from "vitest";
import { missingChannelAccess, missingPermissions, requiredPermissions } from "./permissions.js";

const grant = (...flags: bigint[]) => new PermissionsBitField(flags);

describe("channel permission check", () => {
	it("needs Send Messages in text channels and forum posts", () => {
		expect(requiredPermissions(ChannelType.GuildText)).toEqual(["ViewChannel", "SendMessages"]);
		expect(requiredPermissions(ChannelType.GuildForum)).toEqual(["ViewChannel", "SendMessages"]);
	});

	it("needs Send Messages in Threads inside a thread", () => {
		expect(requiredPermissions(ChannelType.PublicThread)).toEqual([
			"ViewChannel",
			"SendMessagesInThreads",
		]);
	});

	it("reports exactly what is missing", () => {
		const viewOnly = grant(PermissionFlagsBits.ViewChannel);
		expect(missingPermissions(viewOnly, ChannelType.GuildText)).toEqual(["SendMessages"]);
		expect(missingPermissions(grant(), ChannelType.GuildText)).toEqual([
			"ViewChannel",
			"SendMessages",
		]);
		expect(
			missingPermissions(
				grant(PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages),
				ChannelType.GuildAnnouncement,
			),
		).toEqual([]);
	});

	it("treats Administrator as every permission", () => {
		expect(
			missingPermissions(grant(PermissionFlagsBits.Administrator), ChannelType.PrivateThread),
		).toEqual([]);
	});

	it("treats unknown effective permissions as nothing granted", () => {
		expect(missingPermissions(null, ChannelType.GuildText)).toEqual([
			"ViewChannel",
			"SendMessages",
		]);
	});

	it("reports a channel the bot cannot see as not viewable", async () => {
		const client = {
			user: { id: "1" },
			channels: {
				fetch: async () => {
					throw new Error("Unknown Channel");
				},
			},
		} as unknown as Client;
		expect(await missingChannelAccess(client, "123")).toEqual(["ViewChannel", "SendMessages"]);
	});

	it("reads the bot's effective permissions in a visible channel", async () => {
		const channel = {
			type: ChannelType.GuildText,
			permissionsFor: () => grant(PermissionFlagsBits.ViewChannel),
		};
		const client = {
			user: { id: "1" },
			channels: { fetch: async () => channel },
		} as unknown as Client;
		expect(await missingChannelAccess(client, "123")).toEqual(["SendMessages"]);
	});
});
