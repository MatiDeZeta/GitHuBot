import { ChannelType, type Client, PermissionFlagsBits } from "discord.js";

export interface DirectoryChannel {
	id: string;
	name: string;
	/** Forum and media channels get a thread per event rather than a message. */
	kind: "text" | "announcement" | "forum" | "thread";
}

export interface DirectoryRole {
	id: string;
	name: string;
}

export interface GuildDirectory {
	/** False when the bot is not in the server (or Discord has not sent it yet). */
	available: boolean;
	channels: DirectoryChannel[];
	roles: DirectoryRole[];
}

const KINDS: Partial<Record<ChannelType, DirectoryChannel["kind"]>> = {
	[ChannelType.GuildText]: "text",
	[ChannelType.GuildAnnouncement]: "announcement",
	[ChannelType.GuildForum]: "forum",
	[ChannelType.GuildMedia]: "forum",
	[ChannelType.PublicThread]: "thread",
	[ChannelType.PrivateThread]: "thread",
	[ChannelType.AnnouncementThread]: "thread",
};

const EMPTY: GuildDirectory = { available: false, channels: [], roles: [] };

/**
 * The channels and roles the dashboard offers in its pickers, read from the
 * gateway cache the bot already keeps — no extra Discord request per page.
 */
export function guildDirectory(client: Client, guildId: string): GuildDirectory {
	const guild = client.guilds?.cache?.get(guildId);
	if (!guild) return EMPTY;

	const channels: (DirectoryChannel & { position: number })[] = [];
	for (const channel of guild.channels.cache.values()) {
		const kind = KINDS[channel.type];
		if (!kind) continue;
		channels.push({
			id: channel.id,
			name: channel.name,
			kind,
			position: "rawPosition" in channel ? channel.rawPosition : Number.MAX_SAFE_INTEGER,
		});
	}
	channels.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

	const roles = [...guild.roles.cache.values()]
		// @everyone shares the server's id, and a managed role belongs to an integration.
		.filter((role) => role.id !== guild.id && !role.managed)
		.sort((a, b) => b.position - a.position)
		.map((role) => ({ id: role.id, name: role.name }));

	return {
		available: true,
		channels: channels.map(({ position: _position, ...channel }) => channel),
		roles,
	};
}

/**
 * Whether `channelId` is somewhere this server's settings may point at. Without
 * this check a form post could name a channel in a *different* server the bot is
 * in, and that server would start receiving another's changelog.
 */
export async function channelInGuild(
	client: Client,
	guildId: string,
	channelId: string,
): Promise<boolean> {
	if (!/^\d{17,20}$/.test(channelId)) return false;
	const channel = await client.channels.fetch(channelId).catch(() => null);
	if (!channel || !("guildId" in channel) || channel.guildId !== guildId) return false;
	return KINDS[channel.type] !== undefined;
}

export function roleInGuild(client: Client, guildId: string, roleId: string): boolean {
	if (!/^\d{17,20}$/.test(roleId) || roleId === guildId) return false;
	return client.guilds?.cache?.get(guildId)?.roles.cache.has(roleId) ?? false;
}

const RECHECK_MS = 60_000;
const MAX_CACHED = 5_000;
const verified = new Map<string, { allowed: boolean; at: number }>();

/**
 * The session records who managed which server at sign-in, and lasts for hours.
 * Reading with a stale grant is tolerable; changing settings is not, so every
 * write asks Discord — through the bot's own view of the server — whether this
 * person still has Manage Server. Cached briefly so a burst of saves costs one
 * lookup.
 */
export async function stillManages(
	client: Client,
	guildId: string,
	userId: string,
	now = Date.now(),
): Promise<boolean> {
	const key = `${guildId}:${userId}`;
	const cached = verified.get(key);
	if (cached && now - cached.at < RECHECK_MS) return cached.allowed;

	const allowed = await lookUp(client, guildId, userId);
	if (verified.size >= MAX_CACHED) verified.clear();
	verified.set(key, { allowed, at: now });
	return allowed;
}

async function lookUp(client: Client, guildId: string, userId: string): Promise<boolean> {
	const guild = client.guilds?.cache?.get(guildId);
	if (!guild) return false;
	if (guild.ownerId === userId) return true;
	const member = await guild.members.fetch(userId).catch(() => null);
	return member?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false;
}

export function resetPermissionCache(): void {
	verified.clear();
}
