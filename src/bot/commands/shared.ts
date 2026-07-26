import {
	MessageFlags,
	TextDisplayBuilder,
	type AutocompleteInteraction,
	type InteractionEditReplyOptions,
	type InteractionReplyOptions,
	type InteractionUpdateOptions,
	type JSONEncodable,
	type APIMessageTopLevelComponent,
	type RepliableInteraction,
} from "discord.js";
import { repoSlugSchema } from "../../config/events.js";
import type { GuildSettings, TrackedRepo } from "../../db/types.js";
import { resolveLocale, t, type AppLocale, type TranslationKey } from "../../i18n/index.js";
import type { BotContext } from "../client.js";

type TopLevel = JSONEncodable<APIMessageTopLevelComponent>;

export function ephemeralV2(...components: TopLevel[]): InteractionReplyOptions {
	return {
		flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
		components,
	};
}

export function ephemeralText(content: string): InteractionReplyOptions {
	return ephemeralV2(new TextDisplayBuilder().setContent(content));
}

/**
 * `editReply` only accepts `IsComponentsV2` / `SuppressEmbeds` in its flags
 * type; `Ephemeral` is already fixed by the original defer.
 */
export function ephemeralV2Edit(...components: TopLevel[]): InteractionEditReplyOptions {
	return {
		content: null,
		embeds: [],
		flags: MessageFlags.IsComponentsV2 as InteractionEditReplyOptions["flags"],
		components,
	};
}

export function ephemeralTextEdit(content: string): InteractionEditReplyOptions {
	return ephemeralV2Edit(new TextDisplayBuilder().setContent(content));
}

export function v2Update(...components: TopLevel[]): InteractionUpdateOptions {
	return {
		content: null,
		embeds: [],
		flags: MessageFlags.IsComponentsV2 as InteractionEditReplyOptions["flags"],
		components,
	};
}

export function v2UpdateText(content: string): InteractionUpdateOptions {
	return v2Update(new TextDisplayBuilder().setContent(content));
}

export interface GuildContext {
	settings: GuildSettings | null;
	locale: AppLocale;
}

/** One DB read per interaction, shared by every handler that needs strings. */
export async function guildContext(
	ctx: BotContext,
	interaction: { guildId: string | null; locale?: string | null },
): Promise<GuildContext> {
	const settings = interaction.guildId
		? await ctx.repository.getGuildSettings(interaction.guildId)
		: null;
	return {
		settings,
		locale: resolveLocale(settings?.locale, interaction.locale, ctx.env.DEFAULT_LOCALE),
	};
}

export function isAllowedUser(ctx: BotContext, userId: string): boolean {
	return !ctx.env.DISCORD_ALLOWED_USER_ID || ctx.env.DISCORD_ALLOWED_USER_ID === userId;
}

export async function denyIfNotAllowed(
	ctx: BotContext,
	interaction: RepliableInteraction,
	locale: AppLocale,
): Promise<boolean> {
	if (isAllowedUser(ctx, interaction.user.id)) return false;
	await interaction.reply(ephemeralText(t(locale, "common.error.notAllowed")));
	return true;
}

export type ParsedRepo = { owner: string; repo: string; slug: string };

export function parseRepoSlug(raw: string): { error: string } | { value: ParsedRepo } {
	const parsed = repoSlugSchema.safeParse(raw);
	if (!parsed.success) {
		const message = parsed.error.issues[0]?.message;
		return { error: typeof message === "string" ? message : "Invalid repository format" };
	}
	return { value: parsed.data };
}

/** Resolves the `repository` option and loads the row, replying on failure. */
export async function requireTrackedRepo(
	ctx: BotContext,
	interaction: RepliableInteraction & { options: { getString(name: string, required: true): string } },
	locale: AppLocale,
): Promise<TrackedRepo | null> {
	const parsed = parseRepoSlug(interaction.options.getString("repository", true));
	if ("error" in parsed) {
		await interaction.reply(ephemeralText(parsed.error));
		return null;
	}
	const tracked = await ctx.repository.getRepo(
		interaction.guildId ?? "",
		parsed.value.owner,
		parsed.value.repo,
	);
	if (!tracked) {
		await interaction.reply(
			ephemeralText(t(locale, "common.error.repoNotFound", { repo: parsed.value.slug })),
		);
		return null;
	}
	return tracked;
}

export function slugOf(tracked: TrackedRepo): string {
	return `${tracked.owner}/${tracked.repo}`;
}

export function line(locale: AppLocale, key: TranslationKey, params?: Record<string, string | number>): string {
	return t(locale, key, params);
}

/** Discord shows at most 25 autocomplete choices. */
export async function respondRepoAutocomplete(
	ctx: BotContext,
	interaction: AutocompleteInteraction,
): Promise<void> {
	if (!interaction.guildId) {
		await interaction.respond([]);
		return;
	}
	const focused = interaction.options.getFocused().toLowerCase();
	const repos = await ctx.repository.listRepos(interaction.guildId);
	const choices = repos
		.map(slugOf)
		.filter((slug) => slug.toLowerCase().includes(focused))
		.slice(0, 25)
		.map((slug) => ({ name: slug, value: slug }));
	await interaction.respond(choices);
}

export function relative(date: Date | null): string | null {
	if (!date) return null;
	return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}
