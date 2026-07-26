import {
	ActionRowBuilder,
	MessageFlags,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	type ChatInputCommandInteraction,
	type ModalSubmitInteraction,
} from "discord.js";
import {
	EVENT_CATEGORIES,
	EVENT_TYPES,
	eventTypeSchema,
	type EventCategoryId,
	type EventType,
} from "../../config/events.js";
import type { RepoFilters, TrackedRepo } from "../../db/types.js";
import { parseFilterList } from "../../delivery/filters.js";
import { deliverTemplate, renderOptionsFor } from "../../delivery/dispatch.js";
import { resolveChannelId } from "../../delivery/routing.js";
import {
	categoryLabel,
	isAppLocale,
	SUPPORTED_LOCALES,
	t,
	type AppLocale,
} from "../../i18n/index.js";
import { sampleTemplate } from "../render/samples.js";
import { isDisplayMode } from "../render/template.js";
import { isThemeId } from "../render/theme.js";
import type { BotContext } from "../client.js";
import {
	ephemeralText,
	ephemeralTextEdit,
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
		await interaction.reply(
			ephemeralText(t(locale, "repo.test.unsupported", { event: rawEvent })),
		);
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
			ephemeralTextEdit(
				t(locale, "repo.test.sent", { event: eventType, channel: channelId }),
			),
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
	await interaction.reply(
		ephemeralText(
			channel
				? t(locale, "repo.route.set", {
						category: categoryLabel(locale, category),
						repo: slugOf(tracked),
						channel: channel.id,
					})
				: t(locale, "repo.route.cleared", {
						category: categoryLabel(locale, category),
						repo: slugOf(tracked),
					}),
		),
	);
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

	const rawTheme = interaction.options.getString("theme");
	const rawMode = interaction.options.getString("mode");
	const theme = isThemeId(rawTheme) ? rawTheme : (tracked.theme ?? ctx.renderDefaults.theme);
	const mode = isDisplayMode(rawMode) ? rawMode : (tracked.displayMode ?? ctx.renderDefaults.mode);

	await ctx.repository.updateStyle(tracked.guildId, tracked.owner, tracked.repo, {
		theme,
		displayMode: mode,
	});

	await interaction.reply(
		ephemeralText(
			t(locale, "repo.style.saved", {
				repo: slugOf(tracked),
				theme: t(locale, THEME_LABELS[theme]),
				mode: t(locale, MODE_LABELS[mode]),
			}),
		),
	);
}

const THEME_LABELS = {
	default: "repo.style.themeDefault",
	github: "repo.style.themeGithub",
	neon: "repo.style.themeNeon",
	mono: "repo.style.themeMono",
	language: "repo.style.themeLanguage",
} as const;

const MODE_LABELS = {
	detailed: "repo.style.modeDetailed",
	compact: "repo.style.modeCompact",
} as const;

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
		.addComponents(
			filterInput(
				"branchInclude",
				t(locale, "repo.filters.branchInclude"),
				t(locale, "repo.filters.placeholderBranches"),
				tracked.filters.branchInclude,
			),
			filterInput(
				"branchExclude",
				t(locale, "repo.filters.branchExclude"),
				t(locale, "repo.filters.placeholderBranches"),
				tracked.filters.branchExclude,
			),
			filterInput(
				"labels",
				t(locale, "repo.filters.labels"),
				t(locale, "repo.filters.placeholderLabels"),
				tracked.filters.labels,
			),
			filterInput(
				"ignoredActors",
				t(locale, "repo.filters.ignoredActors"),
				t(locale, "repo.filters.placeholderActors"),
				tracked.filters.ignoredActors,
			),
		);

	await interaction.showModal(modal);
}

function filterInput(
	id: string,
	label: string,
	placeholder: string,
	value: string[],
): ActionRowBuilder<TextInputBuilder> {
	const input = new TextInputBuilder()
		.setCustomId(id)
		.setLabel(label.slice(0, 45))
		.setStyle(TextInputStyle.Short)
		.setPlaceholder(placeholder.slice(0, 100))
		.setRequired(false)
		.setMaxLength(300);
	if (value.length > 0) input.setValue(value.join(", ").slice(0, 300));
	return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
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
