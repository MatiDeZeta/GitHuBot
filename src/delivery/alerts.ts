import { code } from "../bot/render/events/common.js";
import { type RenderOptions, renderTemplate } from "../bot/render/render.js";
import type { EventTemplate } from "../bot/render/template.js";
import type { GuildSettings, TrackedRepo } from "../db/types.js";
import { tx } from "../i18n/index.js";
import type { DispatchContext, DispatchOutcome } from "./dispatch.js";
import { resolveTarget, send } from "./routing.js";

export type HealthTransition = "failing" | "recovered";

/**
 * Alerts fire on a change of state only — the first failure after a success, and
 * the first success after failures — so a broken channel produces one alert, not
 * one per event.
 */
export function healthTransition(
	before: TrackedRepo,
	outcome: DispatchOutcome,
): HealthTransition | null {
	const wasFailing =
		before.lastErrorAt !== null &&
		(before.lastSuccessAt === null || before.lastErrorAt > before.lastSuccessAt);
	if ((outcome.status === "failed" || outcome.status === "bad_channel") && !wasFailing) {
		return "failing";
	}
	if (outcome.status === "delivered" && wasFailing) return "recovered";
	return null;
}

/**
 * Concurrent deliveries all read the same "healthy" row before any of them records a
 * failure, so a burst would alert once per event. One alert per repository and
 * state per window absorbs that.
 */
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;
const lastAlert = new Map<string, number>();

export function shouldAlert(trackingId: string, transition: HealthTransition, now = Date.now()) {
	const key = `${trackingId}:${transition}`;
	const previous = lastAlert.get(key);
	if (previous !== undefined && now - previous < ALERT_COOLDOWN_MS) return false;
	lastAlert.set(key, now);
	return true;
}

export function resetAlertCooldowns(): void {
	lastAlert.clear();
}

export function alertTemplate(
	tracked: TrackedRepo,
	transition: HealthTransition,
	outcome: DispatchOutcome,
	channelId: string,
): EventTemplate {
	const repo = `${tracked.owner}/${tracked.repo}`;
	const repoUrl = `https://github.com/${repo}`;
	const common = { repo, repoUrl, timestamp: new Date(), importance: "high" as const };

	if (transition === "recovered") {
		return {
			...common,
			accent: "workflowSuccess",
			icon: "success",
			title: tx("alert.recovered.title"),
			body: tx("alert.recovered.body"),
			fields: [{ label: tx("field.channel"), value: `<#${channelId}>` }],
		};
	}

	const error =
		outcome.status === "failed"
			? outcome.error
			: outcome.status === "bad_channel"
				? `channel ${outcome.channelId} is missing or not writable`
				: undefined;
	return {
		...common,
		accent: "workflowFailure",
		icon: "alert",
		title: tx("alert.failing.title"),
		body: tx("alert.failing.body"),
		fields: [
			{ label: tx("field.channel"), value: `<#${channelId}>` },
			...(error ? [{ label: tx("field.error"), value: code(error.slice(0, 300)) }] : []),
		],
		links: [{ label: tx("link.webhookDeliveries"), url: `${repoUrl}/settings/hooks` }],
	};
}

/**
 * Posts a failing/recovered notice to the server's alert channel, if it has one.
 * Best effort: an alert must never turn a delivery into an error.
 */
export async function maybeAlert(
	ctx: DispatchContext,
	tracked: TrackedRepo,
	guild: GuildSettings | null,
	outcome: DispatchOutcome,
	channelId: string,
	options: RenderOptions,
): Promise<void> {
	const alertChannelId = guild?.alertChannelId;
	if (!alertChannelId) return;
	const transition = healthTransition(tracked, outcome);
	if (!transition || !shouldAlert(tracked.trackingId, transition)) return;

	try {
		const target = await resolveTarget(ctx.client, alertChannelId);
		if (!target.ok) {
			ctx.logger.warn({ alertChannelId, reason: target.reason }, "Alert channel unusable");
			return;
		}
		const rendered = renderTemplate(alertTemplate(tracked, transition, outcome, channelId), {
			...options,
			mode: "detailed",
		});
		await send(
			target.target,
			{ components: rendered.components, flags: rendered.flags, allowedMentions: { parse: [] } },
			`${tracked.owner}/${tracked.repo} · ${transition}`,
		);
	} catch (err) {
		ctx.logger.error({ err, alertChannelId }, "Failed to post delivery alert");
	}
}
