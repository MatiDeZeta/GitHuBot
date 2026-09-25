import type { Logger } from "../config/logger.js";
import type { RepoRepository } from "./types.js";

/**
 * The deliveries ledger only has two readers: dedupe, which needs to outlast
 * GitHub's 3-day redelivery window, and the dashboard sparkline, which reads 7
 * days. 30 leaves a wide margin over both while keeping the table bounded.
 */
export const DELIVERY_RETENTION_DAYS = 30;

const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/**
 * Prunes once at boot and then every six hours. Returns a stop function for
 * shutdown. The timer is unref'd so it never keeps the process alive on its own.
 */
export function startDeliveryPruning(repository: RepoRepository, logger: Logger): () => void {
	const run = async () => {
		try {
			const cutoff = new Date(Date.now() - DELIVERY_RETENTION_DAYS * DAY_MS);
			const removed = await repository.pruneDeliveries(cutoff);
			if (removed > 0) logger.info({ removed }, "Pruned old delivery records");
		} catch (err) {
			logger.error({ err }, "Failed to prune delivery records");
		}
	};

	void run();
	const timer = setInterval(() => void run(), PRUNE_INTERVAL_MS);
	timer.unref();
	return () => clearInterval(timer);
}
