import {
	ActivityType,
	PresenceUpdateStatus,
	type ActivitiesOptions,
	type Client,
} from "discord.js";
import type { PresenceEntry } from "../config/env.js";
import type { Logger } from "../config/logger.js";
import type { RepoRepository } from "../db/types.js";
import { formatUptime, metrics } from "../metrics.js";
import { VERSION } from "../version.js";

/**
 * Discord ignores `assets`, `party`, `timestamps`, `buttons` and `secrets` on
 * bot presences — only `name`, `type`, `state` and `url` are honored. The
 * rotation below is therefore built entirely out of text.
 */

/** Rotate slowly to stay well clear of Discord's presence rate limit. */
export const PRESENCE_ROTATE_MS = 45_000;

export interface PresenceStats {
	trackedRepos: number;
	servers: number;
	eventsToday: number;
	uptimeMs: number;
	pingMs: number;
}

export interface PresenceConfig {
	/** Replaces the built-in lineup when provided. */
	rotation?: PresenceEntry[];
	/** Enables the Streaming activity when it points at Twitch or YouTube. */
	streamUrl?: string;
}

const ACTIVITY_TYPES: Record<PresenceEntry["type"], ActivityType> = {
	playing: ActivityType.Playing,
	streaming: ActivityType.Streaming,
	listening: ActivityType.Listening,
	watching: ActivityType.Watching,
	competing: ActivityType.Competing,
	custom: ActivityType.Custom,
};

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

export function presencePlaceholders(stats: PresenceStats): Record<string, string> {
	return {
		repos: String(stats.trackedRepos),
		servers: String(stats.servers),
		events: String(stats.eventsToday),
		uptime: formatUptime(stats.uptimeMs),
		ping: String(stats.pingMs),
		version: VERSION,
	};
}

export function applyPlaceholders(template: string, values: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** The shipped rotation, used whenever `PRESENCE_ROTATION` is not set. */
export function defaultRotation(stats: PresenceStats): PresenceEntry[] {
	const entries: PresenceEntry[] = [
		{ type: "watching", name: pluralize(stats.trackedRepos, "tracked repo") },
		{ type: "watching", name: pluralize(stats.servers, "server") },
		{ type: "custom", name: "Custom Status", state: `⚡ ${stats.eventsToday} events today` },
		{ type: "watching", name: "GitHub → Discord" },
		{ type: "listening", name: "/repo" },
		{ type: "custom", name: "Custom Status", state: "🐙 Beautiful changelogs · no GitHub token" },
		{ type: "custom", name: "Custom Status", state: `🟢 up ${formatUptime(stats.uptimeMs)}` },
	];
	return entries;
}

export function buildPresenceActivities(
	stats: PresenceStats,
	config: PresenceConfig = {},
): ActivitiesOptions[] {
	const values = presencePlaceholders(stats);
	const source = config.rotation ?? defaultRotation(stats);

	const activities: ActivitiesOptions[] = source.map((entry) => {
		const type = ACTIVITY_TYPES[entry.type];
		const activity: ActivitiesOptions = {
			name: applyPlaceholders(entry.name, values),
			type,
		};
		if (entry.state) activity.state = applyPlaceholders(entry.state, values);
		// A Streaming activity without a URL silently degrades to Playing.
		if (type === ActivityType.Streaming && config.streamUrl) activity.url = config.streamUrl;
		return activity;
	});

	if (config.streamUrl && !config.rotation) {
		activities.push({
			name: `GitHuBot v${VERSION}`,
			type: ActivityType.Streaming,
			url: config.streamUrl,
		});
	}

	return activities;
}

/** Static presence shown before the first stats snapshot lands. */
export const INITIAL_PRESENCE = {
	status: PresenceUpdateStatus.Online,
	activities: [
		{
			name: "GitHub → Discord",
			type: ActivityType.Watching,
		},
	],
} as const;

export interface PresenceContext {
	repository: RepoRepository;
	logger: Logger;
	presence?: PresenceConfig;
}

export function startPresence(client: Client, ctx: PresenceContext): () => void {
	let index = 0;
	let stopped = false;

	const apply = async () => {
		if (stopped || !client.user) return;
		try {
			const snapshot = metrics.snapshot();
			const stats: PresenceStats = {
				trackedRepos: await ctx.repository.countTrackedRepos(),
				servers: client.guilds.cache.size,
				eventsToday: snapshot.deliveredToday,
				uptimeMs: snapshot.uptimeMs,
				pingMs: Math.max(0, Math.round(client.ws.ping)),
			};
			const activities = buildPresenceActivities(stats, ctx.presence);
			const activity = activities[index % activities.length];
			if (!activity) return;
			index = (index + 1) % activities.length;
			client.user.setPresence({
				status: PresenceUpdateStatus.Online,
				activities: [activity],
			});
		} catch (err) {
			ctx.logger.warn({ err }, "Failed to update bot presence");
		}
	};

	void apply();
	const timer = setInterval(() => {
		void apply();
	}, PRESENCE_ROTATE_MS);
	timer.unref?.();

	return () => {
		stopped = true;
		clearInterval(timer);
	};
}
