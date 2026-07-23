import {
	ActivityType,
	PresenceUpdateStatus,
	type ActivitiesOptions,
	type Client,
} from "discord.js";
import type { Logger } from "../config/logger.js";
import type { RepoRepository } from "../db/types.js";

/** Rotate slowly to avoid Discord presence rate-limits. */
export const PRESENCE_ROTATE_MS = 45_000;

export interface PresenceStats {
	trackedRepos: number;
	servers: number;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

/** Pure activity lineup for the current stats snapshot. */
export function buildPresenceActivities(stats: PresenceStats): ActivitiesOptions[] {
	return [
		{
			name: pluralize(stats.trackedRepos, "tracked repo"),
			type: ActivityType.Watching,
		},
		{
			name: pluralize(stats.servers, "server"),
			type: ActivityType.Watching,
		},
		{
			name: "GitHub → Discord",
			type: ActivityType.Watching,
		},
		{
			name: "/repo",
			type: ActivityType.Listening,
		},
		{
			name: "Custom Status",
			type: ActivityType.Custom,
			state: "Beautiful changelogs · no GitHub token",
		},
	];
}

/** Static presence shown before the first async count lands. */
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
}

export function startPresence(client: Client, ctx: PresenceContext): () => void {
	let index = 0;
	let stopped = false;

	const apply = async () => {
		if (stopped || !client.user) return;
		try {
			const stats: PresenceStats = {
				trackedRepos: await ctx.repository.countTrackedRepos(),
				servers: client.guilds.cache.size,
			};
			const activities = buildPresenceActivities(stats);
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
