import { TextDisplayBuilder, type Client, type MessageCreateOptions } from "discord.js";
import type { EventType } from "../config/events.js";
import type { Logger } from "../config/logger.js";
import { buildEventTemplate } from "../bot/render/events/index.js";
import { renderTemplate, type RenderOptions } from "../bot/render/render.js";
import type { EventTemplate } from "../bot/render/template.js";
import { DEFAULT_DISPLAY_MODE } from "../bot/render/template.js";
import { DEFAULT_THEME } from "../bot/render/theme.js";
import type { GuildSettings, RepoRepository, TrackedRepo } from "../db/types.js";
import { DEFAULT_LOCALE, resolveText, type AppLocale } from "../i18n/index.js";
import { metrics } from "../metrics.js";
import { applyFilters, type FilterReason } from "./filters.js";
import { planMentions } from "./mentions.js";
import { resolveChannelId, resolveTarget, send } from "./routing.js";

export interface DispatchContext {
	client: Client;
	repository: RepoRepository;
	logger: Logger;
	/** Instance-wide fallbacks from the environment. */
	defaults: {
		locale: AppLocale;
		theme: RenderOptions["theme"];
		mode: RenderOptions["mode"];
	};
}

export type DispatchOutcome =
	| { status: "delivered" }
	| { status: "paused" }
	| { status: "disabled" }
	| { status: "filtered"; reason: FilterReason }
	| { status: "no_message" }
	| { status: "bad_channel"; channelId: string }
	| { status: "failed"; error: string };

/** Repo setting wins, then guild setting, then the instance default. */
export function renderOptionsFor(
	tracked: TrackedRepo | null,
	guild: GuildSettings | null,
	defaults: DispatchContext["defaults"],
): RenderOptions {
	return {
		theme: tracked?.theme ?? guild?.defaultTheme ?? defaults.theme ?? DEFAULT_THEME,
		mode:
			tracked?.displayMode ?? guild?.defaultDisplayMode ?? defaults.mode ?? DEFAULT_DISPLAY_MODE,
		locale: tracked?.locale ?? guild?.locale ?? defaults.locale ?? DEFAULT_LOCALE,
	};
}

export async function dispatchEvent(
	ctx: DispatchContext,
	tracked: TrackedRepo,
	eventType: EventType,
	payload: unknown,
	guild: GuildSettings | null,
): Promise<DispatchOutcome> {
	if (tracked.paused) return { status: "paused" };
	if (!tracked.enabledEvents.includes(eventType)) return { status: "disabled" };

	const filtered = applyFilters(tracked.filters, eventType, payload);
	if (!filtered.deliver) {
		metrics.recordFiltered();
		return { status: "filtered", reason: filtered.reason ?? "branch" };
	}

	const template = buildEventTemplate(eventType, payload);
	if (!template) return { status: "no_message" };

	const options = renderOptionsFor(tracked, guild, ctx.defaults);
	return deliverTemplate(ctx, tracked, eventType, template, options);
}

/** Shared by real deliveries and `/repo test`. */
export async function deliverTemplate(
	ctx: DispatchContext,
	tracked: TrackedRepo,
	eventType: EventType,
	template: EventTemplate,
	options: RenderOptions,
): Promise<DispatchOutcome> {
	const channelId = resolveChannelId(tracked, eventType);
	const route = await resolveTarget(ctx.client, channelId);
	if (!route.ok) {
		await ctx.repository.recordDeliveryResult({
			trackingId: tracked.trackingId,
			success: false,
			error: `Channel ${channelId} is ${route.reason}`,
		});
		metrics.recordFailed();
		return { status: "bad_channel", channelId };
	}

	const rendered = renderTemplate(template, options);
	const mentions = planMentions(tracked, eventType);
	const components = mentions.line
		? [new TextDisplayBuilder().setContent(mentions.line), ...rendered.components]
		: rendered.components;

	const message: MessageCreateOptions = {
		components,
		flags: rendered.flags,
		allowedMentions: mentions.allowedMentions,
	};

	const threadName = `${resolveText(options.locale, template.title)} · ${template.repo}`;

	try {
		await send(route.target, message, threadName);
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		ctx.logger.error({ err, eventType, channelId }, "Failed to deliver to Discord");
		await ctx.repository.recordDeliveryResult({
			trackingId: tracked.trackingId,
			success: false,
			error,
		});
		metrics.recordFailed();
		return { status: "failed", error };
	}

	await ctx.repository.recordDeliveryResult({
		trackingId: tracked.trackingId,
		success: true,
	});
	metrics.recordDelivered(eventType, `${tracked.owner}/${tracked.repo}`);
	return { status: "delivered" };
}
