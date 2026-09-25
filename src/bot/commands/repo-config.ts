import {
	type ChatInputCommandInteraction,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	type ModalSubmitInteraction,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import {
	EVENT_CATEGORIES,
	EVENT_TYPES,
	type EventCategoryId,
	type EventType,
	eventTypeSchema,
} from "../../config/events.js";
import type { RepoFilters, RepoStyleInput } from "../../db/types.js";
import { deliverTemplate, renderOptionsFor } from "../../delivery/dispatch.js";
import { parseFilterList } from "../../delivery/filters.js";
import { resolveChannelId } from "../../delivery/routing.js";
import {
	type AppLocale,
	categoryLabel,
	isAppLocale,
	localizations,
	SUPPORTED_LOCALES,
	type TranslationKey,
	t,
} from "../../i18n/index.js";
import type { BotContext } from "../client.js";
import { type RenderOptions, renderTemplate } from "../render/render.js";
import { sampleTemplate } from "../render/samples.js";
import { DISPLAY_MODES, type DisplayMode, isDisplayMode } from "../render/template.js";
import { isThemeId, THEME_IDS, type ThemeId } from "../render/theme.js";
import {
	channelAccessWarning,
	ephemeralText,
	ephemeralTextEdit,
	ephemeralV2,
	guildContext,
	isAllowedUser,
	relative,
	requireTrackedRepo,
	slugOf,
} from "./shared.js";

export const FILTERS_MODAL_ID = "repo:filters:";

export const CATEGORY_CHOICES = EVENT_CATEGORIES.map((category) => ({
	name: category.id,
	value: category.id,
}));

export async function handlePause(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
	paused: boolean,
): Promise<void> {
	const tracked = await requireTrackedRepo(ctx, interaction, locale);
	if (!tracked) return;

	if (tracked.paused === paused) {
		await interaction.reply(
			ephemeralText(
				t(locale, paused ? "repo.pause.already" : "repo.resume.already", {
					repo: slugOf(tracked),
				}),
			),
		);
		return;
	}

	await ctx.repository.setPaused(tracked.guildId, tracked.owner, tracked.repo, paused);
	await interaction.reply(
		ephemeralText(
			t(locale, paused ? "repo.pause.done" : "repo.resume.done", { repo: slugOf(tracked) }),
		),
	);
}

export async function handleTest(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
): Promise<void> {
	const tracked = await requireTrackedRepo(ctx, interaction, locale);
	if (!tracked) return;

	const rawEvent = interaction.options.getString("event") ?? "push";
	const parsedEvent = eventTypeSchema.safeParse(rawEvent);
	if (!parsedEvent.success) {
		await interaction.reply(ephemeralText(t(locale, "repo.test.unsupported", { event: rawEvent })));
		return;
	}
	const eventType: EventType = parsedEvent.data;

	await interaction.deferReply({
		flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
	});

	const { settings } = await guildContext(ctx, interaction);
	const template = sampleTemplate(
		eventType,
		slugOf(tracked),
		`https://github.com/${slugOf(tracked)}`,
		{
			login: interaction.user.username,
			avatarUrl: interaction.user.displayAvatarURL({ extension: "png" }),
		},
	);

	const outcome = await deliverTemplate(
		{
			client: interaction.client,
			repository: ctx.repository,
			logger: ctx.logger,
			defaults: ctx.renderDefaults,
		},
		tracked,
		eventType,
		template,
		renderOptionsFor(tracked, settings, ctx.renderDefaults),
	);

	const channelId = resolveChannelId(tracked, eventType);
	if (outcome.status === "delivered") {
		await interaction.editReply(
			ephemeralTextEdit(t(locale, "repo.test.sent", { event: eventType, channel: channelId })),
		);
		return;
	}

	const error = outcome.status === "failed" ? outcome.error : outcome.status;
	await interaction.editReply(
		ephemeralTextEdit(t(locale, "repo.test.failed", { channel: channelId, error })),
	);
}

export async function handleRoute(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
): Promise<void> {
	const tracked = await requireTrackedRepo(ctx, interaction, locale);
	if (!tracked) return;

	const category = interaction.options.getString("category", true) as EventCategoryId;
	const channel = interaction.options.getChannel("channel");
	const routes = { ...tracked.eventRoutes };

	if (channel) {
		routes[category] = channel.id;
	} else {
		delete routes[category];
	}

	await ctx.repository.updateRoutes(tracked.guildId, tracked.owner, tracked.repo, routes);
	if (!channel) {
		await interaction.reply(
			ephemeralText(
				t(locale, "repo.route.cleared", {
					category: categoryLabel(locale, category),
					repo: slugOf(tracked),
				}),
			),
		);
		return;
	}

	const done = t(locale, "repo.route.set", {
		category: categoryLabel(locale, category),
		repo: slugOf(tracked),
		channel: channel.id,
	});
	const access = await channelAccessWarning(interaction, channel.id, locale, slugOf(tracked));
	await interaction.reply(ephemeralText(access ? `${done}\n\n${access}` : done));
}

export async function handleMentions(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
): Promise<void> {
	const tracked = await requireTrackedRepo(ctx, interaction, locale);
	if (!tracked) return;

	const category = interaction.options.getString("category", true) as EventCategoryId;
	const role = interaction.options.getRole("role");
	const mentions = { ...tracked.mentionRules };

	if (role) {
		mentions[category] = [role.id];
	} else {
		delete mentions[category];
	}

	await ctx.repository.updateMentions(tracked.guildId, tracked.owner, tracked.repo, mentions);
	await interaction.reply(
		ephemeralText(
			role
				? t(locale, "repo.mentions.set", {
						role: `<@&${role.id}>`,
						category: categoryLabel(locale, category),
						repo: slugOf(tracked),
					})
				: t(locale, "repo.mentions.cleared", {
						category: categoryLabel(locale, category),
						repo: slugOf(tracked),
					}),
		),
	);
}

export async function handleStyle(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
): Promise<void> {
	const tracked = await requireTrackedRepo(ctx, interaction, locale);
	if (!tracked) return;

	// An omitted option keeps the current value, and `inherit` clears the override so
	// the server or instance default applies again. Writing the effective default
	// here would pin it, and a later DEFAULT_THEME change would never reach the repo.
	const rawTheme = interaction.options.getString("theme");
	const rawMode = interaction.options.getString("mode");
	const style: RepoStyleInput = {};
	if (rawTheme === INHERIT) style.theme = null;
	else if (isThemeId(rawTheme)) style.theme = rawTheme;
	if (rawMode === INHERIT) style.displayMode = null;
	else if (isDisplayMode(rawMode)) style.displayMode = rawMode;

	const changed = Object.keys(style).length > 0;
	const updated = changed
		? ((await ctx.repository.updateStyle(tracked.guildId, tracked.owner, tracked.repo, style)) ??
			tracked)
		: tracked;

	const { settings } = await guildContext(ctx, interaction);
	const effective = renderOptionsFor(updated, settings, ctx.renderDefaults);
	const label = (key: TranslationKey, inherited: boolean) =>
		inherited ? t(locale, "repo.style.inherited", { value: t(locale, key) }) : t(locale, key);

	const summary = t(locale, changed ? "repo.style.saved" : "repo.style.current", {
		repo: slugOf(updated),
		theme: label(THEME_LABELS[effective.theme], updated.theme === null),
		mode: label(MODE_LABELS[effective.mode], updated.displayMode === null),
	});
	await interaction.reply(
		ephemeralV2(
			new TextDisplayBuilder().setContent(summary),
			...stylePreview(
				slugOf(updated),
				`https://github.com/${slugOf(updated)}`,
				effective,
				interaction,
			),
		),
	);
}

/**
 * Two contrasting sample events — a merge and a failed run — rendered in the chosen
 * style, so the reply shows how the theme tells good news from bad before any real
 * event arrives.
 */
function stylePreview(
	repo: string,
	repoUrl: string,
	options: RenderOptions,
	interaction: ChatInputCommandInteraction,
) {
	const actor = {
		login: interaction.user.username,
		avatarUrl: interaction.user.displayAvatarURL({ extension: "png" }),
	};
	return PREVIEW_EVENTS.flatMap(
		(event) => renderTemplate(sampleTemplate(event, repo, repoUrl, actor), options).components,
	);
}

const PREVIEW_EVENTS = ["pull_request", "workflow_run"] as const;

/**
 * `/repo server-style`: the default every repository in this server uses unless it
 * sets its own with `/repo style`. `inherit` here falls back to the instance
 * defaults from the environment.
 */
export async function handleServerStyle(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
): Promise<void> {
	const guildId = interaction.guildId;
	if (!guildId) return;

	const rawTheme = interaction.options.getString("theme");
	const rawMode = interaction.options.getString("mode");
	const update: { defaultTheme?: ThemeId | null; defaultDisplayMode?: DisplayMode | null } = {};
	if (rawTheme === INHERIT) update.defaultTheme = null;
	else if (isThemeId(rawTheme)) update.defaultTheme = rawTheme;
	if (rawMode === INHERIT) update.defaultDisplayMode = null;
	else if (isDisplayMode(rawMode)) update.defaultDisplayMode = rawMode;

	const changed = Object.keys(update).length > 0;
	if (changed) await ctx.repository.updateGuildSettings(guildId, update);

	const settings = await ctx.repository.getGuildSettings(guildId);
	const effective = renderOptionsFor(null, settings, ctx.renderDefaults);
	const label = (key: TranslationKey, inherited: boolean) =>
		inherited
			? t(locale, "repo.serverStyle.botDefault", { value: t(locale, key) })
			: t(locale, key);

	const summary = [
		t(locale, changed ? "repo.serverStyle.saved" : "repo.serverStyle.current", {
			theme: label(THEME_LABELS[effective.theme], !settings?.defaultTheme),
			mode: label(MODE_LABELS[effective.mode], !settings?.defaultDisplayMode),
		}),
		t(locale, "repo.serverStyle.note"),
	].join("\n");
	await interaction.reply(
		ephemeralV2(
			new TextDisplayBuilder().setContent(summary),
			...stylePreview("your-org/your-repo", "https://github.com", effective, interaction),
		),
	);
}

/** Choice value that clears a repository override. */
const INHERIT = "inherit";

const THEME_LABELS = {
	default: "repo.style.themeDefault",
	github: "repo.style.themeGithub",
	neon: "repo.style.themeNeon",
	catppuccin: "repo.style.themeCatppuccin",
	nord: "repo.style.themeNord",
	accessible: "repo.style.themeAccessible",
	mono: "repo.style.themeMono",
	language: "repo.style.themeLanguage",
} as const satisfies Record<ThemeId, TranslationKey>;

const MODE_LABELS = {
	detailed: "repo.style.modeDetailed",
	compact: "repo.style.modeCompact",
} as const satisfies Record<DisplayMode, TranslationKey>;

function localizedChoice(key: TranslationKey, value: string) {
	return { name: t("en", key), name_localizations: localizations(key), value };
}

const INHERIT_CHOICE = localizedChoice("repo.style.inherit", INHERIT);

/** Theme choices with translated names, plus `inherit` to clear the override. */
export const THEME_CHOICES = [
	INHERIT_CHOICE,
	...THEME_IDS.map((id) => localizedChoice(THEME_LABELS[id], id)),
];

export const MODE_CHOICES = [
	INHERIT_CHOICE,
	...DISPLAY_MODES.map((mode) => localizedChoice(MODE_LABELS[mode], mode)),
];

/** For the server default, `inherit` means the bot's own (environment) default. */
const BOT_DEFAULT_CHOICE = localizedChoice("repo.serverStyle.reset", INHERIT);

export const SERVER_THEME_CHOICES = [BOT_DEFAULT_CHOICE, ...THEME_CHOICES.slice(1)];
export const SERVER_MODE_CHOICES = [BOT_DEFAULT_CHOICE, ...MODE_CHOICES.slice(1)];

export async function handleHealth(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
): Promise<void> {
	const tracked = await requireTrackedRepo(ctx, interaction, locale);
	if (!tracked) return;

	const never = t(locale, "common.never");
	const lines = [
		t(locale, "repo.health.heading", { repo: slugOf(tracked) }),
		"",
		t(locale, tracked.paused ? "repo.health.paused" : "repo.health.active"),
		t(locale, "repo.health.delivered", { count: tracked.deliveredCount }),
		t(locale, "repo.health.failed", { count: tracked.failedCount }),
		t(locale, "repo.health.lastDelivery", { when: relative(tracked.lastDeliveryAt) ?? never }),
		t(locale, "repo.health.lastSuccess", { when: relative(tracked.lastSuccessAt) ?? never }),
		tracked.lastError
			? t(locale, "repo.health.lastError", {
					when: relative(tracked.lastErrorAt) ?? never,
					error: tracked.lastError,
				})
			: t(locale, "repo.health.noErrors"),
		...(tracked.observedFullName
			? [
					"",
					t(locale, "repo.health.observed", {
						reported: tracked.observedFullName,
						repo: slugOf(tracked),
					}),
				]
			: []),
		"",
		t(locale, "repo.health.hint"),
	];

	await interaction.reply(ephemeralText(lines.join("\n")));
}

export async function handleLanguage(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
): Promise<void> {
	const raw = interaction.options.getString("locale", true);
	if (!isAppLocale(raw)) {
		await interaction.reply(ephemeralText(t(locale, "common.error.invalidSelection")));
		return;
	}
	await ctx.repository.updateGuildSettings(interaction.guildId ?? "", { locale: raw });
	await interaction.reply(ephemeralText(t(raw, "repo.language.saved", { language: raw })));
}

export const LOCALE_CHOICES = SUPPORTED_LOCALES.map((code) => ({ name: code, value: code }));

export async function showFiltersModal(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
): Promise<void> {
	const parsed = interaction.options.getString("repository", true);
	const tracked = await ctx.repository.getRepo(
		interaction.guildId ?? "",
		parsed.split("/")[0] ?? "",
		parsed.split("/")[1] ?? "",
	);
	if (!tracked) {
		await interaction.reply(
			ephemeralText(t(locale, "common.error.repoNotFound", { repo: parsed })),
		);
		return;
	}

	const modal = new ModalBuilder()
		.setCustomId(`${FILTERS_MODAL_ID}${tracked.id}`)
		.setTitle(`${t(locale, "repo.filters.modalTitle")} · ${slugOf(tracked)}`.slice(0, 45))
		.addLabelComponents(
			filterInput(
				"branchInclude",
				t(locale, "repo.filters.branchInclude"),
				t(locale, "repo.filters.branchIncludeHint"),
				t(locale, "repo.filters.placeholderBranches"),
				tracked.filters.branchInclude,
			),
			filterInput(
				"branchExclude",
				t(locale, "repo.filters.branchExclude"),
				t(locale, "repo.filters.branchExcludeHint"),
				t(locale, "repo.filters.placeholderBranches"),
				tracked.filters.branchExclude,
			),
			filterInput(
				"labels",
				t(locale, "repo.filters.labels"),
				t(locale, "repo.filters.labelsHint"),
				t(locale, "repo.filters.placeholderLabels"),
				tracked.filters.labels,
			),
			filterInput(
				"ignoredActors",
				t(locale, "repo.filters.ignoredActors"),
				t(locale, "repo.filters.ignoredActorsHint"),
				t(locale, "repo.filters.placeholderActors"),
				tracked.filters.ignoredActors,
			),
		);

	await interaction.showModal(modal);
}

/**
 * Discord deprecated Text Input inside an Action Row for modals; Label is the
 * replacement, and it carries a description the old pattern had nowhere to put.
 */
function filterInput(
	id: string,
	label: string,
	description: string,
	placeholder: string,
	value: string[],
): LabelBuilder {
	const input = new TextInputBuilder()
		.setCustomId(id)
		.setStyle(TextInputStyle.Short)
		.setPlaceholder(placeholder.slice(0, 100))
		.setRequired(false)
		.setMaxLength(300);
	if (value.length > 0) input.setValue(value.join(", ").slice(0, 300));

	return new LabelBuilder()
		.setLabel(label.slice(0, 45))
		.setDescription(description.slice(0, 100))
		.setTextInputComponent(input);
}

export async function handleFiltersModal(
	interaction: ModalSubmitInteraction,
	ctx: BotContext,
): Promise<void> {
	const { locale } = await guildContext(ctx, interaction);
	if (!isAllowedUser(ctx, interaction.user.id)) {
		await interaction.reply(ephemeralText(t(locale, "common.error.notAllowed")));
		return;
	}

	const repoId = Number(interaction.customId.slice(FILTERS_MODAL_ID.length));
	const repos = interaction.guildId ? await ctx.repository.listRepos(interaction.guildId) : [];
	const tracked = repos.find((candidate) => candidate.id === repoId);
	if (!tracked) {
		await interaction.reply(ephemeralText(t(locale, "common.error.invalidSelection")));
		return;
	}

	const filters: RepoFilters = {
		branchInclude: parseFilterList(interaction.fields.getTextInputValue("branchInclude")),
		branchExclude: parseFilterList(interaction.fields.getTextInputValue("branchExclude")),
		labels: parseFilterList(interaction.fields.getTextInputValue("labels")),
		ignoredActors: parseFilterList(interaction.fields.getTextInputValue("ignoredActors")),
	};

	await ctx.repository.updateFilters(tracked.guildId, tracked.owner, tracked.repo, filters);
	await interaction.reply(
		ephemeralText(
			[
				t(locale, "repo.filters.saved", { repo: slugOf(tracked) }),
				"",
				summarizeFilters(filters, locale),
			].join("\n"),
		),
	);
}

export function summarizeFilters(filters: RepoFilters, locale: AppLocale): string {
	const parts: string[] = [];
	if (filters.branchInclude.length > 0) {
		parts.push(`**+** \`${filters.branchInclude.join("`, `")}\``);
	}
	if (filters.branchExclude.length > 0) {
		parts.push(`**−** \`${filters.branchExclude.join("`, `")}\``);
	}
	if (filters.labels.length > 0) {
		parts.push(`**#** \`${filters.labels.join("`, `")}\``);
	}
	if (filters.ignoredActors.length > 0) {
		parts.push(`**@** \`${filters.ignoredActors.join("`, `")}\``);
	}
	if (parts.length === 0) return t(locale, "repo.filters.summaryEmpty");
	return parts.join("\n");
}

/** `/repo test` has ~40 event types, past Discord's 25 static choice limit. */
export function eventAutocompleteChoices(focused: string) {
	const needle = focused.toLowerCase();
	return EVENT_TYPES.filter((event) => event.includes(needle))
		.slice(0, 25)
		.map((event) => ({ name: event, value: event }));
}
