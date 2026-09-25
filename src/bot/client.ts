import {
	type APIApplicationEmoji,
	type ChatInputCommandInteraction,
	Client,
	Events,
	GatewayIntentBits,
	type Interaction,
	type InteractionEditReplyOptions,
	MessageFlags,
	Partials,
	type RESTPostAPIApplicationCommandsJSONBody,
	TextDisplayBuilder,
} from "discord.js";
import type { FullyConfiguredEnv } from "../config/env.js";
import type { Logger } from "../config/logger.js";
import type { RepoRepository } from "../db/types.js";
import type { DispatchContext } from "../delivery/dispatch.js";
import { t } from "../i18n/index.js";
import {
	aboutCommand,
	handleAbout,
	handleHelp,
	handlePing,
	handleStats,
	helpCommand,
	pingCommand,
	statsCommand,
} from "./commands/misc.js";
import { handleRepoCommand, repoCommand } from "./commands/repo.js";
import {
	eventAutocompleteChoices,
	FILTERS_MODAL_ID,
	handleFiltersModal,
} from "./commands/repo-config.js";
import { handleEventsComponent } from "./commands/repo-events.js";
import { guildContext, isAllowedUser, respondRepoAutocomplete } from "./commands/shared.js";
import { listApplicationEmojis, syncApplicationEmojis } from "./emojis.js";
import { INITIAL_PRESENCE, startPresence } from "./presence.js";
import { applyApplicationEmojis } from "./render/icons.js";

export interface BotContext {
	env: FullyConfiguredEnv;
	logger: Logger;
	repository: RepoRepository;
	masterKey: Buffer;
	/** Instance-wide render defaults, shared with the webhook pipeline. */
	renderDefaults: DispatchContext["defaults"];
}

const COMMANDS: RESTPostAPIApplicationCommandsJSONBody[] = [
	repoCommand.data.toJSON(),
	helpCommand.data.toJSON(),
	statsCommand.data.toJSON(),
	aboutCommand.data.toJSON(),
	pingCommand.data.toJSON(),
];

export function createBot(ctx: BotContext): Client {
	const client = new Client({
		intents: [GatewayIntentBits.Guilds],
		partials: [Partials.Channel],
		presence: {
			status: INITIAL_PRESENCE.status,
			activities: [...INITIAL_PRESENCE.activities],
		},
	});

	client.once(Events.ClientReady, (readyClient) => {
		ctx.logger.info({ user: readyClient.user.tag }, "Discord bot ready");
		void loadIconEmojis(readyClient, ctx);
		void reconcileGuilds(readyClient, ctx);
		startPresence(readyClient, {
			repository: ctx.repository,
			logger: ctx.logger,
			presence: {
				rotation: ctx.env.PRESENCE_ROTATION,
				streamUrl: ctx.env.PRESENCE_STREAM_URL,
			},
		});
	});

	// Removal starts the grace period before a server's data is purged; coming back
	// cancels it. An outage arrives as an *unavailable* guild, which is not a removal.
	client.on(Events.GuildDelete, (guild) => {
		if (!guild.available) return;
		ctx.repository
			.setGuildLeft(guild.id, new Date())
			.then(() =>
				ctx.logger.info({ guildId: guild.id }, "Removed from server; data purge scheduled"),
			)
			.catch((err) =>
				ctx.logger.error({ err, guildId: guild.id }, "Failed to mark server as left"),
			);
	});
	client.on(Events.GuildCreate, (guild) => {
		ctx.repository
			.setGuildLeft(guild.id, null)
			.catch((err) =>
				ctx.logger.error({ err, guildId: guild.id }, "Failed to mark server as joined"),
			);
	});

	client.on(Events.InteractionCreate, async (interaction: Interaction) => {
		try {
			await route(interaction, ctx);
		} catch (err) {
			ctx.logger.error({ err }, "Interaction handler failed");
			await replyWithError(interaction, ctx);
		}
	});

	return client;
}

/**
 * Switches icons to the bot's `gh_*` application emojis when it has them, uploading
 * any missing ones first if EMOJI_SYNC is on. Best effort: on any failure the
 * Unicode icons simply stay.
 */
async function loadIconEmojis(client: Client<true>, ctx: BotContext): Promise<void> {
	try {
		const applicationId = client.application.id;
		let emojis: APIApplicationEmoji[];
		if (ctx.env.EMOJI_SYNC) {
			const result = await syncApplicationEmojis(client.rest, applicationId);
			emojis = result.emojis;
			if (result.created.length > 0 || result.failed.length > 0) {
				ctx.logger.info(
					{ created: result.created.length, failed: result.failed },
					"Synced application emojis",
				);
			}
		} else {
			emojis = await listApplicationEmojis(client.rest, applicationId);
		}
		const applied = applyApplicationEmojis(emojis);
		if (applied.length > 0) {
			ctx.logger.info({ icons: applied.length }, "Using application emojis for icons");
		}
	} catch (err) {
		ctx.logger.warn({ err }, "Could not load application emojis; keeping Unicode icons");
	}
}

/**
 * Catches removals that happened while the bot was offline: a server with stored
 * data that Discord no longer lists starts its grace period now. The ready cache
 * includes unavailable guilds, so an outage does not count as a removal here either.
 */
async function reconcileGuilds(client: Client<true>, ctx: BotContext): Promise<void> {
	try {
		const now = new Date();
		for (const guildId of await ctx.repository.listGuildIds()) {
			const present = client.guilds.cache.has(guildId);
			await ctx.repository.setGuildLeft(guildId, present ? null : now);
		}
	} catch (err) {
		ctx.logger.error({ err }, "Failed to reconcile servers at startup");
	}
}

async function route(interaction: Interaction, ctx: BotContext): Promise<void> {
	if (interaction.isAutocomplete()) {
		// Autocomplete answers before Discord validates the submit, so it needs the
		// same gate as the command itself or it leaks tracked repo slugs.
		if (!isAllowedUser(ctx, interaction.user.id)) {
			await interaction.respond([]);
			return;
		}
		const focused = interaction.options.getFocused(true);
		if (focused.name === "event") {
			await interaction.respond(eventAutocompleteChoices(focused.value));
			return;
		}
		await respondRepoAutocomplete(ctx, interaction);
		return;
	}

	if (interaction.isChatInputCommand()) {
		await onChatInput(interaction, ctx);
		return;
	}

	if (interaction.isModalSubmit()) {
		if (interaction.customId.startsWith(FILTERS_MODAL_ID)) {
			await handleFiltersModal(interaction, ctx);
		}
		return;
	}

	if (interaction.isStringSelectMenu() || interaction.isButton()) {
		if (isEventsComponent(interaction.customId)) {
			await handleEventsComponent(interaction, ctx);
		}
	}
}

function isEventsComponent(customId: string): boolean {
	return (
		customId.startsWith("repo:evcat:") ||
		customId.startsWith("repo:ev:") ||
		customId.startsWith("repo:evback:") ||
		customId.startsWith("repo:evpreset:")
	);
}

async function onChatInput(interaction: ChatInputCommandInteraction, ctx: BotContext) {
	switch (interaction.commandName) {
		case "repo":
			return handleRepoCommand(interaction, ctx);
		case "help":
			return handleHelp(interaction, ctx);
		case "stats":
			return handleStats(interaction, ctx);
		case "about":
			return handleAbout(interaction, ctx);
		case "ping":
			return handlePing(interaction, ctx);
		default:
			return;
	}
}

async function replyWithError(interaction: Interaction, ctx: BotContext): Promise<void> {
	if (!interaction.isRepliable()) return;
	const { locale } = await guildContext(ctx, interaction).catch(() => ({ locale: "en" as const }));
	const components = [new TextDisplayBuilder().setContent(t(locale, "common.error.generic"))];

	try {
		if (interaction.deferred && !interaction.replied) {
			// A deferred V2 reply cannot be edited with legacy `content`.
			await interaction.editReply({
				content: null,
				embeds: [],
				flags: MessageFlags.IsComponentsV2 as InteractionEditReplyOptions["flags"],
				components,
			});
		} else if (interaction.replied) {
			await interaction.followUp({
				flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				components,
			});
		} else {
			await interaction.reply({
				flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				components,
			});
		}
	} catch (replyErr) {
		ctx.logger.error({ err: replyErr }, "Failed to send interaction error reply");
	}
}

export async function registerCommands(
	client: Client,
	env: FullyConfiguredEnv,
	logger: Logger,
): Promise<void> {
	if (env.DISCORD_GUILD_ID) {
		const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
		await guild.commands.set(COMMANDS);
		logger.info({ guildId: env.DISCORD_GUILD_ID }, "Registered guild slash commands");
		return;
	}
	await client.application?.commands.set(COMMANDS);
	logger.info("Registered global slash commands");
}

export { repoCommand };
