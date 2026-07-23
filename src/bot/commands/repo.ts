import {
	ActionRowBuilder,
	ChannelType,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	type ChatInputCommandInteraction,
	type StringSelectMenuInteraction,
} from "discord.js";
import {
	DEFAULT_ENABLED_EVENTS,
	EVENT_TYPES,
	type EventType,
	repoSlugSchema,
} from "../../config/events.js";
import {
	decryptSecret,
	encryptSecret,
	generateTrackingId,
	generateWebhookSecret,
} from "../../crypto/secrets.js";
import type { BotContext } from "../client.js";

export const repoCommand = {
	data: new SlashCommandBuilder()
		.setName("repo")
		.setDescription("Manage GitHub repositories tracked by this server")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.setDMPermission(false)
		.addSubcommand((sub) =>
			sub
				.setName("add")
				.setDescription("Track a GitHub repository (manual webhook setup)")
				.addStringOption((opt) =>
					opt.setName("repository").setDescription("owner/repo").setRequired(true),
				)
				.addChannelOption((opt) =>
					opt
						.setName("channel")
						.setDescription("Channel for changelog messages")
						.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
						.setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("remove")
				.setDescription("Stop tracking a repository")
				.addStringOption((opt) =>
					opt.setName("repository").setDescription("owner/repo").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub.setName("list").setDescription("List tracked repositories for this server"),
		)
		.addSubcommand((sub) =>
			sub
				.setName("events")
				.setDescription("Toggle which GitHub events are posted")
				.addStringOption((opt) =>
					opt.setName("repository").setDescription("owner/repo").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("channel")
				.setDescription("Change the output channel for a repository")
				.addStringOption((opt) =>
					opt.setName("repository").setDescription("owner/repo").setRequired(true),
				)
				.addChannelOption((opt) =>
					opt
						.setName("channel")
						.setDescription("New target channel")
						.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
						.setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("webhook-info")
				.setDescription("Show webhook Payload URL and secret (ephemeral)")
				.addStringOption((opt) =>
					opt.setName("repository").setDescription("owner/repo").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("regenerate-secret")
				.setDescription("Issue a new webhook secret (update it on GitHub)")
				.addStringOption((opt) =>
					opt.setName("repository").setDescription("owner/repo").setRequired(true),
				),
		),
};

function ephemeralText(content: string) {
	return {
		flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
		components: [new TextDisplayBuilder().setContent(content)],
	};
}

function parseRepoOption(interaction: ChatInputCommandInteraction) {
	const raw = interaction.options.getString("repository", true);
	const parsed = repoSlugSchema.safeParse(raw);
	if (!parsed.success) {
		return { error: parsed.error.issues[0]?.message ?? "Invalid repository format" } as const;
	}
	return { value: parsed.data } as const;
}

async function maybeWarnPrivateRepo(owner: string, repo: string): Promise<string | null> {
	try {
		const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
			headers: {
				Accept: "application/vnd.github+json",
				"User-Agent": "GitHuBot",
			},
			signal: AbortSignal.timeout(4000),
		});
		if (res.status === 404) {
			return `_Note: could not find a **public** repo \`${owner}/${repo}\`. If it is private, that is fine — continue with webhook setup._`;
		}
		return null;
	} catch {
		return null;
	}
}

function webhookUrl(publicBase: string, trackingId: string): string {
	return `${publicBase}/webhooks/github/${trackingId}`;
}

function setupInstructions(opts: {
	owner: string;
	repo: string;
	payloadUrl: string;
	secret: string;
	extra?: string | null;
}): string {
	const lines = [
		`## Track \`${opts.owner}/${opts.repo}\``,
		"",
		"GitHuBot never needs a GitHub token. Create the webhook yourself:",
		"",
		`1. Open https://github.com/${opts.owner}/${opts.repo}/settings/hooks/new`,
		`2. **Payload URL**: \`${opts.payloadUrl}\``,
		"3. **Content type**: `application/json`",
		`4. **Secret**: \`${opts.secret}\``,
		'5. Choose **Send me everything** (or pick events — the bot filters server-side)',
		"6. Save the webhook",
		"",
		"_This message is ephemeral. Store the secret securely — you can re-display it with `/repo webhook-info`._",
	];
	if (opts.extra) {
		lines.splice(2, 0, opts.extra, "");
	}
	return lines.join("\n");
}

export async function handleRepoCommand(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
): Promise<void> {
	if (!interaction.guildId) {
		await interaction.reply(ephemeralText("This command can only be used in a server."));
		return;
	}

	const sub = interaction.options.getSubcommand();
	switch (sub) {
		case "add":
			await handleAdd(interaction, ctx);
			break;
		case "remove":
			await handleRemove(interaction, ctx);
			break;
		case "list":
			await handleList(interaction, ctx);
			break;
		case "events":
			await handleEvents(interaction, ctx);
			break;
		case "channel":
			await handleChannel(interaction, ctx);
			break;
		case "webhook-info":
			await handleWebhookInfo(interaction, ctx);
			break;
		case "regenerate-secret":
			await handleRegenerateSecret(interaction, ctx);
			break;
		default:
			await interaction.reply(ephemeralText("Unknown subcommand."));
	}
}

async function handleAdd(interaction: ChatInputCommandInteraction, ctx: BotContext) {
	const parsed = parseRepoOption(interaction);
	if ("error" in parsed) {
		await interaction.reply(ephemeralText(parsed.error));
		return;
	}
	const { owner, repo } = parsed.value;
	const guildId = interaction.guildId!;
	const channel =
		interaction.options.getChannel("channel") ?? interaction.channel;
	if (!channel || !("id" in channel)) {
		await interaction.reply(ephemeralText("Could not resolve a target channel."));
		return;
	}

	const existing = await ctx.repository.getRepo(guildId, owner, repo);
	if (existing) {
		await interaction.reply(
			ephemeralText(`\`${owner}/${repo}\` is already tracked. Use \`/repo webhook-info\` or \`/repo remove\` first.`),
		);
		return;
	}

	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const warning = await maybeWarnPrivateRepo(owner, repo);
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
		await interaction.editReply({
			flags: MessageFlags.IsComponentsV2,
			components: [
				new TextDisplayBuilder().setContent(
					"Failed to save the repository. It may already be tracked.",
				),
			],
		});
		return;
	}

	const payloadUrl = webhookUrl(ctx.env.PUBLIC_WEBHOOK_URL, trackingId);
	await interaction.editReply({
		flags: MessageFlags.IsComponentsV2,
		components: [
			new TextDisplayBuilder().setContent(
				setupInstructions({ owner, repo, payloadUrl, secret, extra: warning }),
			),
		],
	});
}

async function handleRemove(interaction: ChatInputCommandInteraction, ctx: BotContext) {
	const parsed = parseRepoOption(interaction);
	if ("error" in parsed) {
		await interaction.reply(ephemeralText(parsed.error));
		return;
	}
	const { owner, repo } = parsed.value;
	const removed = await ctx.repository.removeRepo(interaction.guildId!, owner, repo);
	if (!removed) {
		await interaction.reply(ephemeralText(`\`${owner}/${repo}\` is not tracked on this server.`));
		return;
	}
	await interaction.reply(
		ephemeralText(
			[
				`Removed \`${owner}/${repo}\` from this server.`,
				"",
				"Also delete the webhook manually from GitHub:",
				`https://github.com/${owner}/${repo}/settings/hooks`,
				"",
				"_GitHuBot cannot delete GitHub webhooks — it holds no GitHub credentials._",
			].join("\n"),
		),
	);
}

async function handleList(interaction: ChatInputCommandInteraction, ctx: BotContext) {
	const repos = await ctx.repository.listRepos(interaction.guildId!);
	if (repos.length === 0) {
		await interaction.reply(
			ephemeralText("No repositories tracked yet. Use `/repo add owner/repo`."),
		);
		return;
	}

	const lines = repos.map((r) => {
		const events = r.enabledEvents.join(", ");
		return `• **${r.owner}/${r.repo}** → <#${r.channelId}>\n  Events: \`${events}\``;
	});

	await interaction.reply(
		ephemeralText(`## Tracked repositories\n\n${lines.join("\n\n")}`),
	);
}

async function handleEvents(interaction: ChatInputCommandInteraction, ctx: BotContext) {
	const parsed = parseRepoOption(interaction);
	if ("error" in parsed) {
		await interaction.reply(ephemeralText(parsed.error));
		return;
	}
	const { owner, repo } = parsed.value;
	const tracked = await ctx.repository.getRepo(interaction.guildId!, owner, repo);
	if (!tracked) {
		await interaction.reply(ephemeralText(`\`${owner}/${repo}\` is not tracked.`));
		return;
	}

	const select = new StringSelectMenuBuilder()
		.setCustomId(`repo:events:${tracked.id}`)
		.setPlaceholder("Toggle enabled events")
		.setMinValues(0)
		.setMaxValues(EVENT_TYPES.length)
		.addOptions(
			EVENT_TYPES.map((event) => ({
				label: event,
				value: event,
				default: tracked.enabledEvents.includes(event),
				description: DEFAULT_ENABLED_EVENTS.includes(event)
					? "On by default"
					: "Off by default",
			})),
		);

	await interaction.reply({
		flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
		components: [
			new TextDisplayBuilder().setContent(
				`## Events for \`${owner}/${repo}\`\nSelect which events should post to <#${tracked.channelId}>.`,
			),
			new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
		],
	});
}

export async function handleRepoSelect(
	interaction: StringSelectMenuInteraction,
	ctx: BotContext,
): Promise<void> {
	const idPart = interaction.customId.replace("repo:events:", "");
	const repoId = Number(idPart);
	if (!Number.isFinite(repoId) || !interaction.guildId) {
		await interaction.reply(ephemeralText("Invalid selection."));
		return;
	}

	const repos = await ctx.repository.listRepos(interaction.guildId);
	const tracked = repos.find((r) => r.id === repoId);
	if (!tracked) {
		await interaction.reply(ephemeralText("Repository not found."));
		return;
	}

	const enabled = interaction.values as EventType[];
	await ctx.repository.updateEvents(
		tracked.guildId,
		tracked.owner,
		tracked.repo,
		enabled,
	);

	await interaction.update({
		flags: MessageFlags.IsComponentsV2,
		components: [
			new TextDisplayBuilder().setContent(
				`## Events updated for \`${tracked.owner}/${tracked.repo}\`\nEnabled: ${
					enabled.length ? enabled.map((e) => `\`${e}\``).join(", ") : "_none_"
				}`,
			),
		],
	});
}

async function handleChannel(interaction: ChatInputCommandInteraction, ctx: BotContext) {
	const parsed = parseRepoOption(interaction);
	if ("error" in parsed) {
		await interaction.reply(ephemeralText(parsed.error));
		return;
	}
	const { owner, repo } = parsed.value;
	const channel = interaction.options.getChannel("channel", true);
	const updated = await ctx.repository.updateChannel(
		interaction.guildId!,
		owner,
		repo,
		channel.id,
	);
	if (!updated) {
		await interaction.reply(ephemeralText(`\`${owner}/${repo}\` is not tracked.`));
		return;
	}
	await interaction.reply(
		ephemeralText(`\`${owner}/${repo}\` will now post to <#${channel.id}>.`),
	);
}

async function handleWebhookInfo(interaction: ChatInputCommandInteraction, ctx: BotContext) {
	const parsed = parseRepoOption(interaction);
	if ("error" in parsed) {
		await interaction.reply(ephemeralText(parsed.error));
		return;
	}
	const { owner, repo } = parsed.value;
	const tracked = await ctx.repository.getRepo(interaction.guildId!, owner, repo);
	if (!tracked) {
		await interaction.reply(ephemeralText(`\`${owner}/${repo}\` is not tracked.`));
		return;
	}

	const secret = decryptSecret(tracked.encryptedSecret, ctx.masterKey);
	const payloadUrl = webhookUrl(ctx.env.PUBLIC_WEBHOOK_URL, tracked.trackingId);
	await interaction.reply(
		ephemeralText(
			[
				`## Webhook info · \`${owner}/${repo}\``,
				"",
				`**Payload URL**: \`${payloadUrl}\``,
				`**Secret**: \`${secret}\``,
				"**Content type**: `application/json`",
				"",
				`Configure at: https://github.com/${owner}/${repo}/settings/hooks`,
			].join("\n"),
		),
	);
}

async function handleRegenerateSecret(
	interaction: ChatInputCommandInteraction,
	ctx: BotContext,
) {
	const parsed = parseRepoOption(interaction);
	if ("error" in parsed) {
		await interaction.reply(ephemeralText(parsed.error));
		return;
	}
	const { owner, repo } = parsed.value;
	const tracked = await ctx.repository.getRepo(interaction.guildId!, owner, repo);
	if (!tracked) {
		await interaction.reply(ephemeralText(`\`${owner}/${repo}\` is not tracked.`));
		return;
	}

	const secret = generateWebhookSecret();
	const encryptedSecret = encryptSecret(secret, ctx.masterKey);
	await ctx.repository.rotateSecret({
		guildId: interaction.guildId!,
		owner,
		repo,
		encryptedSecret,
		encryptedPreviousSecret: tracked.encryptedSecret,
	});
	const payloadUrl = webhookUrl(ctx.env.PUBLIC_WEBHOOK_URL, tracked.trackingId);

	await interaction.reply(
		ephemeralText(
			[
				`## New secret for \`${owner}/${repo}\``,
				"",
				"Update the **Secret** field on your GitHub webhook:",
				`https://github.com/${owner}/${repo}/settings/hooks`,
				"",
				`**Payload URL**: \`${payloadUrl}\``,
				`**New secret**: \`${secret}\``,
				"",
				"_The previous secret remains accepted until GitHub starts signing with the new one, so deliveries are not dropped mid-cutover._",
			].join("\n"),
		),
	);
}
