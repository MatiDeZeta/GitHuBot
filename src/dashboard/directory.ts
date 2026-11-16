import { ChannelType, type Client, type GuildMember, PermissionFlagsBits } from "discord.js";

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
 * Manage Server does not let someone see a private channel, so neither may the
 * dashboard: a channel is offered, and accepted, only if the signed-in member
 * can view it in Discord. Otherwise the pickers would list the names of hidden
 * channels, and a form post could aim a repository's messages into one.
 */
function visibleTo(channel: unknown, viewer: GuildMember | null | undefined): boolean {
	if (viewer === undefined) return true;
	if (viewer === null) return false;
	const permissionsFor = (channel as { permissionsFor?: unknown }).permissionsFor;
	// Every real server channel has it; only a non-server channel would not, and
	// those are already rejected by the `guildId` and kind checks.
	if (typeof permissionsFor !== "function") return true;
	const permissions = permissionsFor.call(channel, viewer) as {
		has(bit: bigint): boolean;
	} | null;
	return permissions?.has(PermissionFlagsBits.ViewChannel) ?? false;
}

/**
 * The channels and roles the dashboard offers in its pickers, read from the
 * gateway cache the bot already keeps — no extra Discord request per page.
 * With a `viewer`, channels that member cannot see are left out.
 */
export function guildDirectory(
	client: Client,
	guildId: string,
	viewer?: GuildMember | null,
): GuildDirectory {
	const guild = client.guilds?.cache?.get(guildId);
	if (!guild) return EMPTY;

	const channels: (DirectoryChannel & { position: number })[] = [];
	for (const channel of guild.channels.cache.values()) {
		const kind = KINDS[channel.type];
		if (!kind) continue;
		if (!visibleTo(channel, viewer)) continue;
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
	viewer?: GuildMember | null,
): Promise<boolean> {
	if (!/^\d{17,20}$/.test(channelId)) return false;
	const channel = await client.channels.fetch(channelId).catch(() => null);
	if (!channel || !("guildId" in channel) || channel.guildId !== guildId) return false;
	if (KINDS[channel.type] === undefined) return false;
	return visibleTo(channel, viewer);
}

export function roleInGuild(client: Client, guildId: string, roleId: string): boolean {
	if (!/^\d{17,20}$/.test(roleId) || roleId === guildId) return false;
	return client.guilds?.cache?.get(guildId)?.roles.cache.has(roleId) ?? false;
}

const RECHECK_MS = 60_000;
const MAX_CACHED = 5_000;

export interface Standing {
	/** Whether this person holds Manage Server (or owns the server) right now. */
	allowed: boolean;
	/** Their membership, for per-channel visibility. Null when they are not a member. */
	member: GuildMember | null;
}

const verified = new Map<string, Standing & { at: number }>();

/**
 * The session records who managed which server at sign-in, and lasts for hours,
 * so it is only a hint. Every page and every change asks Discord — through the
 * bot's own view of the server — whether this person still has Manage Server.
 * Cached briefly so a burst of requests costs one lookup.
 */
export async function standingOf(
	client: Client,
	guildId: string,
	userId: string,
	now = Date.now(),
): Promise<Standing> {
	const key = `${guildId}:${userId}`;
	const cached = verified.get(key);
	if (cached && now - cached.at < RECHECK_MS) return cached;

	const standing = await lookUp(client, guildId, userId);
	if (verified.size >= MAX_CACHED) verified.clear();
	verified.set(key, { ...standing, at: now });
	return standing;
}

export async function stillManages(
	client: Client,
	guildId: string,
	userId: string,
	now = Date.now(),
): Promise<boolean> {
	return (await standingOf(client, guildId, userId, now)).allowed;
}

async function lookUp(client: Client, guildId: string, userId: string): Promise<Standing> {
	const guild = client.guilds?.cache?.get(guildId);
	if (!guild) return { allowed: false, member: null };
	// `force` is the point of the whole check. The bot runs without the
	// GuildMembers intent, so Discord never tells it when a member's roles change
	// or when they leave: a member already in discord.js's cache keeps the roles
	// they had when first fetched. Reading that cache would report Manage Server
	// for someone demoted or kicked since — until the bot restarted.
	const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
	if (guild.ownerId === userId) return { allowed: true, member };
	return {
		allowed: member?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false,
		member,
	};
}

export function resetPermissionCache(): void {
	verified.clear();
}
