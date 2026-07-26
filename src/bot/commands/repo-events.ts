import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	type ButtonInteraction,
	type StringSelectMenuInteraction,
} from "discord.js";
import {
	DEFAULT_ENABLED_EVENTS,
	EVENT_CATEGORIES,
	EVENT_META,
	EVENT_TYPES,
	eventsInCategory,
	type EventCategoryId,
	type EventType,
} from "../../config/events.js";
import type { TrackedRepo } from "../../db/types.js";
import {
	categoryDescription,
	categoryLabel,
	eventDescription,
	eventLabel,
	t,
	type AppLocale,
} from "../../i18n/index.js";
import { icon } from "../render/icons.js";
import type { BotContext } from "../client.js";
import { ephemeralText, guildContext, isAllowedUser, slugOf, v2Update } from "./shared.js";

/*
 * Custom ID grammar (Discord caps these at 100 characters):
 *   repo:evcat:<repoId>          category select
 *   repo:ev:<repoId>:<category>  toggle select inside a category
 *   repo:evback:<repoId>         back to the category list
 *   repo:evpreset:<repoId>       preset select
 */
export const EVENTS_CATEGORY_ID = "repo:evcat:";
export const EVENTS_TOGGLE_ID = "repo:ev:";
export const EVENTS_BACK_ID = "repo:evback:";
export const EVENTS_PRESET_ID = "repo:evpreset:";

const PRESETS = {
	minimal: ["push", "release"] as EventType[],
	standard: DEFAULT_ENABLED_EVENTS,
	everything: [...EVENT_TYPES] as EventType[],
	none: [] as EventType[],
};

type PresetName = keyof typeof PRESETS;

function isPresetName(value: string): value is PresetName {
	return value in PRESETS;
}

function enabledInCategory(tracked: TrackedRepo, category: EventCategoryId): number {
	return eventsInCategory(category).filter((event) => tracked.enabledEvents.includes(event))
		.length;
}

/** Screen one: pick a category, or apply a preset. */
export function categoryView(tracked: TrackedRepo, locale: AppLocale) {
	const header = new TextDisplayBuilder().setContent(
		[
			t(locale, "repo.events.heading", { repo: slugOf(tracked) }),
			t(locale, "repo.events.intro", { count: tracked.enabledEvents.length }),
		].join("\n"),
	);

	const categorySelect = new StringSelectMenuBuilder()
		.setCustomId(`${EVENTS_CATEGORY_ID}${tracked.id}`)
		.setPlaceholder(t(locale, "repo.events.categoryPlaceholder"))
		.addOptions(
			EVENT_CATEGORIES.map((category) => {
				const total = eventsInCategory(category.id).length;
				const enabled = enabledInCategory(tracked, category.id);
				return {
					label: `${icon(category.icon)} ${categoryLabel(locale, category.id)}`,
					value: category.id,
					description: `${t(locale, "repo.events.categoryCount", { enabled, total })} · ${categoryDescription(locale, category.id)}`.slice(
						0,
						100,
					),
				};
			}),
		);

	const presetSelect = new StringSelectMenuBuilder()
		.setCustomId(`${EVENTS_PRESET_ID}${tracked.id}`)
		.setPlaceholder(t(locale, "repo.events.presetsLabel"))
		.addOptions(
			{ label: t(locale, "repo.events.preset.minimal"), value: "minimal" },
			{ label: t(locale, "repo.events.preset.standard"), value: "standard" },
			{ label: t(locale, "repo.events.preset.everything"), value: "everything" },
			{ label: t(locale, "repo.events.preset.none"), value: "none" },
		);

	return [
		header,
		new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(categorySelect),
		new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(presetSelect),
	];
}

/** Screen two: toggle the events inside one category (always under 25 options). */
export function toggleView(
	tracked: TrackedRepo,
	category: EventCategoryId,
	locale: AppLocale,
) {
	const events = eventsInCategory(category);
	const enabled = events.filter((event) => tracked.enabledEvents.includes(event));

	const header = new TextDisplayBuilder().setContent(
		[
			t(locale, "repo.events.categoryHeading", {
				category: categoryLabel(locale, category),
				repo: slugOf(tracked),
			}),
			t(locale, "repo.events.categorySummary", {
				enabled: enabled.length,
				total: events.length,
			}),
		].join("\n"),
	);

	const select = new StringSelectMenuBuilder()
		.setCustomId(`${EVENTS_TOGGLE_ID}${tracked.id}:${category}`)
		.setPlaceholder(
			t(locale, "repo.events.togglePlaceholder", { category: categoryLabel(locale, category) }),
		)
		.setMinValues(0)
		.setMaxValues(events.length)
		.addOptions(
			events.map((event) => ({
				label: `${icon(EVENT_META[event].icon)} ${eventLabel(locale, event)}`,
				value: event,
				default: tracked.enabledEvents.includes(event),
				description: eventDescription(locale, event).slice(0, 100),
			})),
		);

	const back = new ButtonBuilder()
		.setCustomId(`${EVENTS_BACK_ID}${tracked.id}`)
		.setStyle(ButtonStyle.Secondary)
		.setLabel(t(locale, "repo.events.back"));

	return [
		header,
		new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
		new ActionRowBuilder<ButtonBuilder>().addComponents(back),
	];
}

async function loadRepo(
	ctx: BotContext,
	guildId: string | null,
	rawId: string,
): Promise<TrackedRepo | null> {
	const repoId = Number(rawId);
	if (!Number.isFinite(repoId) || !guildId) return null;
	const repos = await ctx.repository.listRepos(guildId);
	return repos.find((candidate) => candidate.id === repoId) ?? null;
}

export async function handleEventsComponent(
	interaction: StringSelectMenuInteraction | ButtonInteraction,
	ctx: BotContext,
): Promise<void> {
	const { locale } = await guildContext(ctx, interaction);

	if (!isAllowedUser(ctx, interaction.user.id)) {
		await interaction.reply(ephemeralText(t(locale, "common.error.notAllowed")));
		return;
	}

	const [, kind, rawId, rawCategory] = interaction.customId.split(":");
	const tracked = await loadRepo(ctx, interaction.guildId, rawId ?? "");
	if (!tracked) {
		await interaction.reply(ephemeralText(t(locale, "common.error.invalidSelection")));
		return;
	}

	if (kind === "evback") {
		await interaction.update(v2Update(...categoryView(tracked, locale)));
		return;
	}

	if (!interaction.isStringSelectMenu()) {
		await interaction.reply(ephemeralText(t(locale, "common.error.invalidSelection")));
		return;
	}

	if (kind === "evcat") {
		const category = interaction.values[0] as EventCategoryId | undefined;
		if (!category) {
			await interaction.update(v2Update(...categoryView(tracked, locale)));
			return;
		}
		await interaction.update(v2Update(...toggleView(tracked, category, locale)));
		return;
	}

	if (kind === "evpreset") {
		const preset = interaction.values[0];
		if (!preset || !isPresetName(preset)) {
			await interaction.update(v2Update(...categoryView(tracked, locale)));
			return;
		}
		const events = [...PRESETS[preset]];
		const updated =
			(await ctx.repository.updateEvents(
				tracked.guildId,
				tracked.owner,
				tracked.repo,
				events,
			)) ?? { ...tracked, enabledEvents: events };

		await interaction.update(
			v2Update(
				new TextDisplayBuilder().setContent(
					t(locale, "repo.events.presetApplied", {
						preset: t(locale, `repo.events.preset.${preset}` as const),
						count: events.length,
					}),
				),
				...categoryView(updated, locale).slice(1),
			),
		);
		return;
	}

	if (kind === "ev") {
		const category = rawCategory as EventCategoryId | undefined;
		if (!category) {
			await interaction.update(v2Update(...categoryView(tracked, locale)));
			return;
		}

		// Selections only describe this category, so preserve everything else.
		const inCategory = new Set(eventsInCategory(category));
		const selected = new Set(interaction.values as EventType[]);
		const next = [
			...tracked.enabledEvents.filter((event) => !inCategory.has(event)),
			...[...selected].filter((event) => inCategory.has(event)),
		];

		const updated =
			(await ctx.repository.updateEvents(tracked.guildId, tracked.owner, tracked.repo, next)) ??
			{ ...tracked, enabledEvents: next };

		await interaction.update(
			v2Update(
				new TextDisplayBuilder().setContent(
					t(locale, "repo.events.updated", {
						category: categoryLabel(locale, category),
						repo: slugOf(updated),
						count: next.length,
					}),
				),
				...toggleView(updated, category, locale).slice(1),
			),
		);
		return;
	}

	await interaction.reply(ephemeralText(t(locale, "common.error.invalidSelection")));
}
