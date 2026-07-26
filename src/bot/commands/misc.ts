import {
	InteractionContextType,
	SlashCommandBuilder,
	version as discordJsVersion,
	type ChatInputCommandInteraction,
} from "discord.js";
import { localizations, t, type TranslationKey } from "../../i18n/index.js";
import { formatUptime, metrics } from "../../metrics.js";
import { VERSION } from "../../version.js";
import { icon } from "../render/icons.js";
import type { BotContext } from "../client.js";
import { ephemeralText, guildContext, slugOf } from "./shared.js";

const REPOSITORY_URL = "https://github.com/MatiDeZeta/GitHuBot";

const HELP_TOPICS = ["setup", "events", "filters", "style", "troubleshooting"] as const;
type HelpTopic = (typeof HELP_TOPICS)[number];

const TOPIC_BODY: Record<HelpTopic, TranslationKey> = {
	setup: "help.setup.body",
	events: "help.events.body",
	filters: "help.filters.body",
	style: "help.style.body",
	troubleshooting: "help.troubleshooting.body",
};

const TOPIC_TITLE: Record<HelpTopic, TranslationKey> = {
	setup: "help.topic.setup",
	events: "help.topic.events",
	filters: "help.topic.filters",
	style: "help.topic.style",
	troubleshooting: "help.topic.troubleshooting",
};

export const helpCommand = {
	data: new SlashCommandBuilder()
		.setName("help")
		.setDescription(t("en", "cmd.help.description"))
		.setDescriptionLocalizations(localizations("cmd.help.description"))
		.setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
		.addStringOption((opt) =>
			opt
				.setName("topic")
				.setDescription(t("en", "cmd.help.option.topic"))
				.setRequired(false)
				.addChoices(...HELP_TOPICS.map((topic) => ({ name: topic, value: topic }))),
		),
};

export const statsCommand = {
	data: new SlashCommandBuilder()
		.setName("stats")
		.setDescription(t("en", "cmd.stats.description"))
		.setDescriptionLocalizations(localizations("cmd.stats.description"))
		.setContexts(InteractionContextType.Guild),
};

export const aboutCommand = {
	data: new SlashCommandBuilder()
		.setName("about")
		.setDescription(t("en", "cmd.about.description"))
		.setDescriptionLocalizations(localizations("cmd.about.description"))
		.setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),
};

export const pingCommand = {
	data: new SlashCommandBuilder()
		.setName("ping")
		.setDescription(t("en", "cmd.ping.description"))
		.setDescriptionLocalizations(localizations("cmd.ping.description"))
		.setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),
};

function isHelpTopic(value: string | null): value is HelpTopic {
	return value !== null && (HELP_TOPICS as readonly string[]).includes(value);
}

export async function handleHelp(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
): Promise<void> {
	const { locale } = await guildContext(ctx, interaction);
	const topic = interaction.options.getString("topic");

	if (isHelpTopic(topic)) {
		await interaction.reply(
			ephemeralText(`### ${t(locale, TOPIC_TITLE[topic])}\n\n${t(locale, TOPIC_BODY[topic])}`),
		);
		return;
	}

	const sections = HELP_TOPICS.map(
		(entry) => `### ${t(locale, TOPIC_TITLE[entry])}\n${t(locale, TOPIC_BODY[entry])}`,
	);

	await interaction.reply(
		ephemeralText(
			[
				`${t(locale, "help.heading")} v${VERSION}`,
				t(locale, "help.intro"),
				"",
				...sections,
			].join("\n"),
		),
	);
}

export async function handleStats(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
): Promise<void> {
	const { locale } = await guildContext(ctx, interaction);
	const snapshot = metrics.snapshot();
	const [trackedRepos, guildRepos] = await Promise.all([
		ctx.repository.countTrackedRepos(),
		interaction.guildId ? ctx.repository.listRepos(interaction.guildId) : Promise.resolve([]),
	]);

	const lastEvent = snapshot.lastEvent
		? `\`${snapshot.lastEvent.type}\` · ${snapshot.lastEvent.repo} · <t:${Math.floor(
				snapshot.lastEvent.at.getTime() / 1000,
			)}:R>`
		: t(locale, "common.never");

	const lines = [
		`${icon("github")} ${t(locale, "stats.heading")}`,
		"",
		t(locale, "stats.version", { value: VERSION }),
		t(locale, "stats.uptime", { value: formatUptime(snapshot.uptimeMs) }),
		t(locale, "stats.latency", { value: Math.max(0, Math.round(interaction.client.ws.ping)) }),
		"",
		t(locale, "stats.servers", { value: interaction.client.guilds.cache.size }),
		t(locale, "stats.trackedRepos", { value: trackedRepos }),
		t(locale, "stats.guildRepos", { value: guildRepos.length }),
		"",
		t(locale, "stats.received", { value: snapshot.received }),
		t(locale, "stats.delivered", { value: snapshot.delivered }),
		t(locale, "stats.today", { value: snapshot.deliveredToday }),
		t(locale, "stats.filtered", { value: snapshot.filtered }),
		t(locale, "stats.failed", { value: snapshot.failed }),
		"",
		t(locale, "stats.lastEvent", { value: lastEvent }),
	];

	if (guildRepos.length > 0) {
		const busiest = [...guildRepos]
			.sort((a, b) => b.deliveredCount - a.deliveredCount)
			.slice(0, 5)
			.map((repo) => `- **${slugOf(repo)}** — ${repo.deliveredCount}`);
		lines.push("", ...busiest);
	}

	await interaction.reply(ephemeralText(lines.join("\n")));
}

export async function handleAbout(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
): Promise<void> {
	const { locale } = await guildContext(ctx, interaction);

	await interaction.reply(
		ephemeralText(
			[
				t(locale, "about.heading", { version: VERSION }),
				t(locale, "about.tagline"),
				"",
				t(locale, "about.runtime", {
					node: process.versions.node,
					djs: discordJsVersion,
				}),
				t(locale, "about.license"),
				t(locale, "about.repository", { url: REPOSITORY_URL }),
				"",
				t(locale, "about.help"),
			].join("\n"),
		),
	);
}

export async function handlePing(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
): Promise<void> {
	const { locale } = await guildContext(ctx, interaction);
	const sentAt = Date.now();
	await interaction.reply(
		ephemeralText(
			t(locale, "ping.reply", {
				latency: Math.max(0, Math.round(interaction.client.ws.ping)),
				roundTrip: Math.max(0, Date.now() - sentAt),
			}),
		),
	);
}