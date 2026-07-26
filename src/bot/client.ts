import {
	Client,
	Events,
	GatewayIntentBits,
	MessageFlags,
	Partials,
	TextDisplayBuilder,
	type ChatInputCommandInteraction,
	type Interaction,
	type InteractionEditReplyOptions,
	type RESTPostAPIApplicationCommandsJSONBody,
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
import { handleEventsComponent } from "./commands/repo-events.js";
import {
	eventAutocompleteChoices,
	FILTERS_MODAL_ID,
	handleFiltersModal,
} from "./commands/repo-config.js";
import { guildContext, respondRepoAutocomplete } from "./commands/shared.js";
import { INITIAL_PRESENCE, startPresence } from "./presence.js";

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
		startPresence(readyClient, {
			repository: ctx.repository,
			logger: ctx.logger,
			presence: {
				rotation: ctx.env.PRESENCE_ROTATION,
				streamUrl: ctx.env.PRESENCE_STREAM_URL,
			},
		});
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

async function route(interaction: Interaction, ctx: BotContext): Promise<void> {
	if (interaction.isAutocomplete()) {
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
