import { type Guild, RESTJSONErrorCodes } from "discord.js";
import type { Logger } from "../config/logger.js";

/**
 * A private instance is one bot run for one Discord account: the operator set
 * DISCORD_ALLOWED_USER_ID, so nobody else can use the commands or the dashboard.
 * Such a bot has no business in a server its owner is not in — nobody there
 * could configure it — so when it is invited to one, it leaves.
 *
 * It runs only for a fresh invite, never at startup, and it leaves only when
 * Discord states outright that the owner is not a member. A timeout, an outage
 * or any other error keeps the bot where it is: wrongly staying costs nothing,
 * wrongly leaving starts the countdown to deleting that server's data.
 *
 * Returns whether the bot left.
 */
export async function leaveIfOwnerAbsent(
	guild: Pick<Guild, "id" | "ownerId" | "members" | "leave">,
	ownerId: string | undefined,
	logger: Logger,
): Promise<boolean> {
	if (!ownerId || guild.ownerId === ownerId) return false;
	try {
		// Forced: the bot has no GuildMembers intent, so its member cache is not kept
		// current and proves nothing either way.
		await guild.members.fetch({ user: ownerId, force: true });
		return false;
	} catch (err) {
		const code = (err as { code?: unknown } | null)?.code;
		if (code !== RESTJSONErrorCodes.UnknownMember) {
			logger.warn(
				{ err, guildId: guild.id },
				"Private instance: could not check whether the owner is in a newly joined server; staying",
			);
			return false;
		}
	}
	try {
		await guild.leave();
		logger.warn(
			{ guildId: guild.id },
			"Private instance: left a server its owner is not a member of",
		);
		return true;
	} catch (err) {
		logger.error({ err, guildId: guild.id }, "Private instance: failed to leave a server");
		return false;
	}
}
