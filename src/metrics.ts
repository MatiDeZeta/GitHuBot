/**
 * Process-local counters powering `/stats` and the rotating presence.
 * Deliberately in-memory: these are operational vitals, not business data, and
 * resetting them on redeploy is the expected behaviour.
 */

export interface MetricsSnapshot {
	startedAt: Date;
	uptimeMs: number;
	received: number;
	delivered: number;
	failed: number;
	filtered: number;
	duplicates: number;
	deliveredToday: number;
	lastEvent: { type: string; repo: string; at: Date } | null;
}

export class MetricsRegistry {
	private readonly startedAt = new Date();
	private received = 0;
	private delivered = 0;
	private failed = 0;
	private filtered = 0;
	private duplicates = 0;
	private deliveredToday = 0;
	private todayKey = dayKey(new Date());
	private lastEvent: { type: string; repo: string; at: Date } | null = null;

	recordReceived(): void {
		this.received += 1;
	}

	recordDelivered(eventType: string, repo: string): void {
		this.delivered += 1;
		this.rollOver();
		this.deliveredToday += 1;
		this.lastEvent = { type: eventType, repo, at: new Date() };
	}

	recordFailed(): void {
		this.failed += 1;
	}

	recordFiltered(): void {
		this.filtered += 1;
	}

	recordDuplicate(): void {
		this.duplicates += 1;
	}

	snapshot(): MetricsSnapshot {
		this.rollOver();
		return {
			startedAt: this.startedAt,
			uptimeMs: Date.now() - this.startedAt.getTime(),
			received: this.received,
			delivered: this.delivered,
			failed: this.failed,
			filtered: this.filtered,
			duplicates: this.duplicates,
			deliveredToday: this.deliveredToday,
			lastEvent: this.lastEvent,
		};
	}

	/** Resets the daily bucket when the UTC date changes. */
	private rollOver(): void {
		const today = dayKey(new Date());
		if (today !== this.todayKey) {
			this.todayKey = today;
			this.deliveredToday = 0;
		}
	}
}

function dayKey(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export const metrics = new MetricsRegistry();

export function formatUptime(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const days = Math.floor(totalSeconds / 86_400);
	const hours = Math.floor((totalSeconds % 86_400) / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;

	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}
