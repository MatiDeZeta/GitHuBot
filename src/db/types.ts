import type { EventType } from "../config/events.js";

export interface TrackedRepo {
	id: number;
	guildId: string;
	owner: string;
	repo: string;
	channelId: string;
	trackingId: string;
	encryptedSecret: string;
	encryptedPreviousSecret: string | null;
	enabledEvents: EventType[];
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateTrackedRepoInput {
	guildId: string;
	owner: string;
	repo: string;
	channelId: string;
	trackingId: string;
	encryptedSecret: string;
	enabledEvents: EventType[];
}

export interface RotateSecretInput {
	guildId: string;
	owner: string;
	repo: string;
	/** New current secret (encrypted). */
	encryptedSecret: string;
	/** Previous current secret retained for verifyWithFallback. */
	encryptedPreviousSecret: string;
}

export interface RepoRepository {
	ensureGuild(guildId: string): Promise<void>;
	addRepo(input: CreateTrackedRepoInput): Promise<TrackedRepo>;
	removeRepo(guildId: string, owner: string, repo: string): Promise<TrackedRepo | null>;
	listRepos(guildId: string): Promise<TrackedRepo[]>;
	/** Global count of tracked repos across all guilds (for bot presence). */
	countTrackedRepos(): Promise<number>;
	getRepo(guildId: string, owner: string, repo: string): Promise<TrackedRepo | null>;
	findByTrackingId(trackingId: string): Promise<TrackedRepo | null>;
	updateChannel(
		guildId: string,
		owner: string,
		repo: string,
		channelId: string,
	): Promise<TrackedRepo | null>;
	updateEvents(
		guildId: string,
		owner: string,
		repo: string,
		enabledEvents: EventType[],
	): Promise<TrackedRepo | null>;
	/** Rotate secret: new becomes current, old current becomes previous (fallback). */
	rotateSecret(input: RotateSecretInput): Promise<TrackedRepo | null>;
	/** Drop the previous secret after the new one is confirmed in use. */
	clearPreviousSecret(trackingId: string): Promise<void>;
	/** Returns true if this delivery is new and was recorded; false if duplicate. */
	tryRecordDelivery(deliveryId: string, trackingId: string): Promise<boolean>;
}
