import {
	ChannelType,
	type Client,
	PermissionFlagsBits,
	type PermissionsBitField,
} from "discord.js";

export type ChannelPermission = "ViewChannel" | "SendMessages" | "SendMessagesInThreads";

const THREAD_TYPES: ReadonlySet<ChannelType> = new Set([
	ChannelType.PublicThread,
	ChannelType.PrivateThread,
	ChannelType.AnnouncementThread,
]);

/**
 * What `send()` in routing.ts needs for each kind of target: threads take
 * "Send Messages in Threads", while text channels and forum/media posts
 * (a new post is a message) take "Send Messages".
 */
export function requiredPermissions(type: ChannelType): ChannelPermission[] {
	return THREAD_TYPES.has(type)
		? ["ViewChannel", "SendMessagesInThreads"]
		: ["ViewChannel", "SendMessages"];
}

/** Administrator implies everything, which `has` accounts for by default. */
export function missingPermissions(
	granted: Readonly<PermissionsBitField> | null,
	type: ChannelType,
): ChannelPermission[] {
	const required = requiredPermissions(type);
	if (!granted) return required;
	return required.filter((name) => !granted.has(PermissionFlagsBits[name]));
}

/**
 * Checks the bot's effective permissions in a channel, so a missing grant
 * surfaces while someone is configuring the repository rather than as a
 * failed delivery later. Empty means the bot can post there.
 */
export async function missingChannelAccess(
	client: Client,
	channelId: string,
): Promise<ChannelPermission[]> {
	const channel = await client.channels.fetch(channelId).catch(() => null);
	// Discord answers "unknown channel" for one the bot cannot see.
	if (!channel || !client.user || !("permissionsFor" in channel)) {
		return ["ViewChannel", "SendMessages"];
	}
	return missingPermissions(channel.permissionsFor(client.user), channel.type);
}
