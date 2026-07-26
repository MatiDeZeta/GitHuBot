import {
	ChannelType,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
	type SlashCommandSubcommandBuilder,
} from "discord.js";
import { DEFAULT_ENABLED_EVENTS, repoSlugSchema } from "../../config/events.js";
import {
	decryptSecret,
	encryptSecret,
	generateTrackingId,
	generateWebhookSecret,
} from "../../crypto/secrets.js";
import { localizations, t, type AppLocale, type TranslationKey } from "../../i18n/index.js";
import { THEME_IDS } from "../render/theme.js";
import { DISPLAY_MODES } from "../render/template.js";
import type { BotContext } from "../client.js";
import { categoryView } from "./repo-events.js";
import {
	CATEGORY_CHOICES,
	handleHealth,
	handleLanguage,
	handleMentions,
	handlePause,
	handleRoute,
	handleStyle,
	handleTest,
	LOCALE_CHOICES,
	showFiltersModal,
	summarizeFilters,
} from "./repo-config.js";
import {
	ephemeralText,
	ephemeralTextEdit,
	ephemeralV2,
	guildContext,
	parseRepoSlug,
	relative,
	requireTrackedRepo,
	slugOf,
} from "./shared.js";

const TEXT_CHANNEL_TYPES = [
	ChannelType.GuildText,
	ChannelType.GuildAnnouncement,
	ChannelType.PublicThread,
	ChannelType.PrivateThread,
	ChannelType.AnnouncementThread,
	ChannelType.GuildForum,
	ChannelType.GuildMedia,
] as const;

/** Every subcommand that targets one repository shares this option. */
function repoOption(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
	return sub.addStringOption((opt) =>
		opt
			.setName("repository")
			.setDescription(t("en", "cmd.repo.option.repository"))
			.setDescriptionLocalizations(localizations("cmd.repo.option.repository"))
			.setRequired(true)
			.setAutocomplete(true),
	);
}

function describe(sub: SlashCommandSubcommandBuilder, key: TranslationKey) {
	return sub.setDescription(t("en", key)).setDescriptionLocalizations(localizations(key));
}

export const repoCommand = {
	data: new SlashCommandBuilder()
		.setName("repo")
		.setDescription(t("en", "cmd.repo.description"))
		.setDescriptionLocalizations(localizations("cmd.repo.description"))
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.setContexts(InteractionContextType.Guild)
		.addSubcommand((sub) =>
			repoOption(describe(sub.setName("add"), "cmd.repo.add.description")).addChannelOption(
				(opt) =>
					opt
						.setName("channel")
						.setDescription(t("en", "cmd.repo.add.option.channel"))
						.addChannelTypes(...TEXT_CHANNEL_TYPES)
						.setRequired(false),
			),
		)
		.addSubcommand((sub) => repoOption(describe(sub.setName("remove"), "cmd.repo.remove.description")))
		.addSubcommand((sub) => describe(sub.setName("list"), "cmd.repo.list.description"))
		.addSubcommand((sub) => repoOption(describe(sub.setName("events"), "cmd.repo.events.description")))
		.addSubcommand((sub) =>
			repoOption(describe(sub.setName("channel"), "cmd.repo.channel.description")).addChannelOption(
				(opt) =>
					opt
						.setName("channel")
						.setDescription(t("en", "cmd.repo.channel.option.channel"))
						.addChannelTypes(...TEXT_CHANNEL_TYPES)
						.setRequired(true),
			),
		)
		.addSubcommand((sub) =>
			repoOption(describe(sub.setName("webhook-info"), "cmd.repo.webhookInfo.description")),
		)
		.addSubcommand((sub) =>
			repoOption(
				describe(sub.setName("regenerate-secret"), "cmd.repo.regenerateSecret.description"),
			),
		)
		.addSubcommand((sub) => repoOption(describe(sub.setName("pause"), "cmd.repo.pause.description")))
		.addSubcommand((sub) => repoOption(describe(sub.setName("resume"), "cmd.repo.resume.description")))
		.addSubcommand((sub) =>
			repoOption(describe(sub.setName("test"), "cmd.repo.test.description")).addStringOption((opt) =>
				opt
					.setName("event")
					.setDescription(t("en", "cmd.repo.test.option.event"))
					.setRequired(false)
					.setAutocomplete(true),
			),
		)
		.addSubcommand((sub) => repoOption(describe(sub.setName("filters"), "cmd.repo.filters.description")))
		.addSubcommand((sub) =>
			repoOption(describe(sub.setName("route"), "cmd.repo.route.description"))
				.addStringOption((opt) =>
					opt
						.setName("category")
						.setDescription(t("en", "cmd.repo.route.option.category"))
						.setRequired(true)
						.addChoices(...CATEGORY_CHOICES),
				)
				.addChannelOption((opt) =>
					opt
						.setName("channel")
						.setDescription(t("en", "cmd.repo.route.option.channel"))
						.addChannelTypes(...TEXT_CHANNEL_TYPES)
						.setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			repoOption(describe(sub.setName("mentions"), "cmd.repo.mentions.description"))
				.addStringOption((opt) =>
					opt
						.setName("category")
						.setDescription(t("en", "cmd.repo.mentions.option.category"))
						.setRequired(true)
						.addChoices(...CATEGORY_CHOICES),
				)
				.addRoleOption((opt) =>
					opt
						.setName("role")
						.setDescription(t("en", "cmd.repo.mentions.option.role"))
						.setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			repoOption(describe(sub.setName("style"), "cmd.repo.style.description"))
				.addStringOption((opt) =>
					opt
						.setName("theme")
						.setDescription(t("en", "cmd.repo.style.option.theme"))
						.setRequired(false)
						.addChoices(...THEME_IDS.map((theme) => ({ name: theme, value: theme }))),
				)
				.addStringOption((opt) =>
					opt
						.setName("mode")
						.setDescription(t("en", "cmd.repo.style.option.mode"))
						.setRequired(false)
						.addChoices(...DISPLAY_MODES.map((mode) => ({ name: mode, value: mode }))),
				),
		)
		.addSubcommand((sub) => repoOption(describe(sub.setName("health"), "cmd.repo.health.description")))
		.addSubcommand((sub) =>
			describe(sub.setName("language"), "cmd.repo.language.description").addStringOption((opt) =>
				opt
					.setName("locale")
					.setDescription(t("en", "cmd.repo.language.option.locale"))
					.setRequired(true)
					.addChoices(...LOCALE_CHOICES),
			),
		),
};

export async function handleRepoCommand(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
): Promise<void> {
	const { locale } = await guildContext(ctx, interaction);

	if (!interaction.guildId) {
		await interaction.reply(ephemeralText(t(locale, "common.error.guildOnly")));
		return;
	}

	if (
		ctx.env.DISCORD_ALLOWED_USER_ID &&
		interaction.user.id !== ctx.env.DISCORD_ALLOWED_USER_ID
	) {
		await interaction.reply(ephemeralText(t(locale, "common.error.notAllowed")));
		return;
	}

	switch (interaction.options.getSubcommand()) {
		case "add":
			return handleAdd(interaction, ctx, locale);
		case "remove":
			return handleRemove(interaction, ctx, locale);
		case "list":
			return handleList(interaction, ctx, locale);
		case "events":
			return handleEvents(interaction, ctx, locale);
		case "channel":
			return handleChannel(interaction, ctx, locale);
		case "webhook-info":
			return handleWebhookInfo(interaction, ctx, locale);
		case "regenerate-secret":
			return handleRegenerateSecret(interaction, ctx, locale);
		case "pause":
			return handlePause(interaction, ctx, locale, true);
		case "resume":
			return handlePause(interaction, ctx, locale, false);
		case "test":
			return handleTest(interaction, ctx, locale);
		case "filters":
			return showFiltersModal(interaction, ctx, locale);
		case "route":
			return handleRoute(interaction, ctx, locale);
		case "mentions":
			return handleMentions(interaction, ctx, locale);
		case "style":
			return handleStyle(interaction, ctx, locale);
		case "health":
			return handleHealth(interaction, ctx, locale);
		case "language":
			return handleLanguage(interaction, ctx, locale);
		default:
			await interaction.reply(ephemeralText(t(locale, "common.error.unknownSubcommand")));
	}
}

/**
 * Best-effort public-repo existence check on `/repo add` only.
 * Unauthenticated GitHub REST is 60 req/hour **per originating IP**, not per
 * tracked repo. Incoming webhooks are unaffected. Always fail open.
 */
async function maybeWarnPrivateRepo(
	owner: string,
	repo: string,
	locale: AppLocale,
): Promise<string | null> {
	try {
		const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
			headers: {
				Accept: "application/vnd.github+json",
				"User-Agent": "GitHuBot",
			},
			signal: AbortSignal.timeout(4000),
		});
		if (res.status === 404) {
			return t(locale, "repo.add.privateWarning", { repo: `${owner}/${repo}` });
		}
		return null;
	} catch {
		return null;
	}
}

function webhookUrl(publicBase: string, trackingId: string): string {
	return `${publicBase}/webhooks/github/${trackingId}`;
}

async function handleAdd(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
) {
	const parsed = parseRepoSlug(interaction.options.getString("repository", true));
	if ("error" in parsed) {
		await interaction.reply(ephemeralText(parsed.error));
		return;
	}
	const { owner, repo, slug } = parsed.value;
	const guildId = interaction.guildId!;
	const channel = interaction.options.getChannel("channel") ?? interaction.channel;
	if (!channel || !("id" in channel)) {
		await interaction.reply(ephemeralText(t(locale, "repo.add.noChannel")));
		return;
	}

	const existing = await ctx.repository.getRepo(guildId, owner, repo);
	if (existing) {
		await interaction.reply(ephemeralText(t(locale, "repo.add.alreadyTracked", { repo: slug })));
		return;
	}

	await interaction.deferReply({
		flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
	});

	const warning = await maybeWarnPrivateRepo(owner, repo, locale);
	const trackingId = generateTrackingId();
	const secret = generateWebhookSecret();
	const encryptedSecret = encryptSecret(secret, ctx.masterKey);

	try {
		await ctx.repository.addRepo({
			guildId,
			owner,
			repo,
			channelId: channel.id,
			trackingId,
			encryptedSecret,
			enabledEvents: [...DEFAULT_ENABLED_EVENTS],
		});
	} catch (err) {
		ctx.logger.error({ err }, "Failed to add repo");
		await interaction.editReply(ephemeralTextEdit(t(locale, "repo.add.saveFailed")));
		return;
	}

	const payloadUrl = webhookUrl(ctx.env.PUBLIC_WEBHOOK_URL, trackingId);
	const lines = [
		t(locale, "repo.add.heading", { repo: slug }),
		"",
		...(warning ? [warning, ""] : []),
		t(locale, "repo.add.intro"),
		"",
		t(locale, "repo.add.step1", { url: `https://github.com/${slug}/settings/hooks/new` }),
		t(locale, "repo.add.step2", { url: payloadUrl }),
		t(locale, "repo.add.step3"),
		t(locale, "repo.add.step4", { secret }),
		t(locale, "repo.add.step5"),
		t(locale, "repo.add.step6"),
		"",
		t(locale, "repo.add.next", { repo: slug }),
		"",
		t(locale, "repo.add.footer"),
	];

	await interaction.editReply(ephemeralTextEdit(lines.join("\n")));
}

async function handleRemove(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
) {
	const parsed = parseRepoSlug(interaction.options.getString("repository", true));
	if ("error" in parsed) {
		await interaction.reply(ephemeralText(parsed.error));
		return;
	}
	const { owner, repo, slug } = parsed.value;
	const removed = await ctx.repository.removeRepo(interaction.guildId!, owner, repo);
	if (!removed) {
		await interaction.reply(ephemeralText(t(locale, "common.error.repoNotFound", { repo: slug })));
		return;
	}

	await interaction.reply(
		ephemeralText(
			[
				t(locale, "repo.remove.done", { repo: slug }),
				"",
				t(locale, "repo.remove.deleteHook"),
				`https://github.com/${slug}/settings/hooks`,
				"",
				t(locale, "repo.remove.noCredentials"),
			].join("\n"),
		),
	);
}

async function handleList(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
) {
	const repos = await ctx.repository.listRepos(interaction.guildId!);
	if (repos.length === 0) {
		await interaction.reply(ephemeralText(t(locale, "repo.list.empty")));
		return;
	}

	const entries = repos.map((tracked) => {
		const details = [
			t(locale, "repo.list.events", { count: tracked.enabledEvents.length }),
			...(tracked.paused ? [t(locale, "repo.list.paused")] : []),
			...(Object.keys(tracked.eventRoutes).length > 0
				? [t(locale, "repo.list.routes", { count: Object.keys(tracked.eventRoutes).length })]
				: []),
			...(tracked.lastDeliveryAt
				? [
						t(locale, "repo.list.lastDelivery", {
							when: relative(tracked.lastDeliveryAt) ?? t(locale, "common.never"),
						}),
					]
				: []),
		];
		const filters = summarizeFilters(tracked.filters, locale);
		const filterLine =
			tracked.filters.branchInclude.length +
				tracked.filters.branchExclude.length +
				tracked.filters.labels.length +
				tracked.filters.ignoredActors.length >
			0
				? `\n${filters.replace(/\n/g, " · ")}`
				: "";

		return `${t(locale, "repo.list.entry", {
			repo: slugOf(tracked),
			channel: tracked.channelId,
		})}\n-# ${details.join(" · ")}${filterLine}`;
	});

	await interaction.reply(
		ephemeralText(`${t(locale, "repo.list.heading")}\n\n${entries.join("\n\n")}`),
	);
}

async function handleEvents(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
) {
	const tracked = await requireTrackedRepo(ctx, interaction, locale);
	if (!tracked) return;
	await interaction.reply(ephemeralV2(...categoryView(tracked, locale)));
}

async function handleChannel(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
) {
	const parsed = parseRepoSlug(interaction.options.getString("repository", true));
	if ("error" in parsed) {
		await interaction.reply(ephemeralText(parsed.error));
		return;
	}
	const { owner, repo, slug } = parsed.value;
	const channel = interaction.options.getChannel("channel", true);
	const updated = await ctx.repository.updateChannel(
		interaction.guildId!,
		owner,
		repo,
		channel.id,
	);
	if (!updated) {
		await interaction.reply(ephemeralText(t(locale, "common.error.repoNotFound", { repo: slug })));
		return;
	}
	await interaction.reply(
		ephemeralText(t(locale, "repo.channel.done", { repo: slug, channel: channel.id })),
	);
}

async function handleWebhookInfo(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
) {
	const tracked = await requireTrackedRepo(ctx, interaction, locale);
	if (!tracked) return;

	const secret = decryptSecret(tracked.encryptedSecret, ctx.masterKey);
	const payloadUrl = webhookUrl(ctx.env.PUBLIC_WEBHOOK_URL, tracked.trackingId);
	const slug = slugOf(tracked);

	await interaction.reply(
		ephemeralText(
			[
				t(locale, "repo.webhookInfo.heading", { repo: slug }),
				"",
				t(locale, "repo.webhookInfo.payloadUrl", { url: payloadUrl }),
				t(locale, "repo.webhookInfo.secret", { secret }),
				t(locale, "repo.webhookInfo.contentType"),
				"",
				t(locale, "repo.webhookInfo.configureAt", {
					url: `https://github.com/${slug}/settings/hooks`,
				}),
			].join("\n"),
		),
	);
}

async function handleRegenerateSecret(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
	locale: AppLocale,
) {
	const tracked = await requireTrackedRepo(ctx, interaction, locale);
	if (!tracked) return;

	const secret = generateWebhookSecret();
	const encryptedSecret = encryptSecret(secret, ctx.masterKey);
	await ctx.repository.rotateSecret({
		guildId: tracked.guildId,
		owner: tracked.owner,
		repo: tracked.repo,
		encryptedSecret,
		encryptedPreviousSecret: tracked.encryptedSecret,
	});

	const payloadUrl = webhookUrl(ctx.env.PUBLIC_WEBHOOK_URL, tracked.trackingId);
	const slug = slugOf(tracked);

	await interaction.reply(
		ephemeralText(
			[
				t(locale, "repo.regenerate.heading", { repo: slug }),
				"",
				t(locale, "repo.regenerate.instruction"),
				`https://github.com/${slug}/settings/hooks`,
				"",
				t(locale, "repo.webhookInfo.payloadUrl", { url: payloadUrl }),
				t(locale, "repo.regenerate.newSecret", { secret }),
				"",
				t(locale, "repo.regenerate.gracePeriod"),
			].join("\n"),
		),
	);
}

export { repoSlugSchema };
