import {
	ChannelType,
	type Client,
	type ForumChannel,
	type GuildTextBasedChannel,
	type MediaChannel,
	type MessageCreateOptions,
} from "discord.js";
import { categoryOf, type EventType } from "../config/events.js";
import type { TrackedRepo } from "../db/types.js";

/** Anything we know how to post into, once resolved. */
export type DeliveryTarget =
	| { kind: "channel"; channel: GuildTextBasedChannel }
	| { kind: "forum"; channel: ForumChannel | MediaChannel };

export type RouteFailure =
	| { ok: false; reason: "missing" }
	| { ok: false; reason: "unsupported" };

export type RouteResult = { ok: true; target: DeliveryTarget } | RouteFailure;

/**
 * Per-event overrides win, then per-category, then the repository default.
 * Routes are stored keyed by either an event type or a category id so a single
 * `/repo route` call can cover a whole group.
 */
export function resolveChannelId(tracked: TrackedRepo, eventType: EventType): string {
	const routes = tracked.eventRoutes;
	return routes[eventType] ?? routes[categoryOf(eventType)] ?? tracked.channelId;
}

export async function resolveTarget(
	client: Client,
	channelId: string,
): Promise<RouteResult> {
	const channel = await client.channels.fetch(channelId).catch(() => null);
	if (!channel) return { ok: false, reason: "missing" };

	if (channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia) {
		return { ok: true, target: { kind: "forum", channel: channel as ForumChannel | MediaChannel } };
	}

	if ("send" in channel && typeof channel.send === "function" && "guild" in channel) {
		return { ok: true, target: { kind: "channel", channel: channel as GuildTextBasedChannel } };
	}

	return { ok: false, reason: "unsupported" };
}

/**
 * Forum and media channels cannot receive plain messages, so each event becomes
 * a thread. The title is trimmed to Discord's 100 character limit.
 */
export async function send(
	target: DeliveryTarget,
	message: MessageCreateOptions,
	threadName: string,
): Promise<void> {
	if (target.kind === "forum") {
		await target.channel.threads.create({
			name: threadName.slice(0, 100) || "GitHub update",
			message,
		});
		return;
	}
	await target.channel.send(message);
}
