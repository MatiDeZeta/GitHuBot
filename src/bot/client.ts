import {
	Client,
	Collection,
	Events,
	GatewayIntentBits,
	MessageFlags,
	Partials,
	TextDisplayBuilder,
	type ChatInputCommandInteraction,
	type Interaction,
} from "discord.js";
import type { FullyConfiguredEnv } from "../config/env.js";
import type { Logger } from "../config/logger.js";
import type { RepoRepository } from "../db/types.js";
import { repoCommand, handleRepoCommand, handleRepoSelect } from "./commands/repo.js";
import { INITIAL_PRESENCE, startPresence } from "./presence.js";

export interface BotContext {
	env: FullyConfiguredEnv;
	logger: Logger;
	repository: RepoRepository;
	masterKey: Buffer;
}

export function createBot(ctx: BotContext): Client {
	const client = new Client({
		intents: [GatewayIntentBits.Guilds],
		partials: [Partials.Channel],
		presence: {
			status: INITIAL_PRESENCE.status,
			activities: [...INITIAL_PRESENCE.activities],
		},
	});

	const commands = new Collection<string, typeof repoCommand>();
	commands.set(repoCommand.data.name, repoCommand);

	client.once(Events.ClientReady, (readyClient) => {
		ctx.logger.info({ user: readyClient.user.tag }, "Discord bot ready");
		startPresence(readyClient, ctx);
	});

	client.on(Events.InteractionCreate, async (interaction: Interaction) => {
		try {
			if (interaction.isChatInputCommand()) {
				await onChatInput(interaction, ctx);
				return;
			}
			if (interaction.isStringSelectMenu() && interaction.customId.startsWith("repo:events:")) {
				await handleRepoSelect(interaction, ctx);
			}
		} catch (err) {
			ctx.logger.error({ err }, "Interaction handler failed");
			const v2Error = {
				flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
				components: [
					new TextDisplayBuilder().setContent(
						"Something went wrong handling that interaction.",
					),
				],
			};
			if (!interaction.isRepliable()) return;
			try {
				if (interaction.deferred || interaction.replied) {
					// Deferred V2 replies cannot use legacy `content` follow-ups.
					if (interaction.deferred && !interaction.replied) {
						await interaction.editReply({
							content: null,
							embeds: [],
							flags: MessageFlags.IsComponentsV2,
							components: v2Error.components,
						});
					} else {
						await interaction.followUp(v2Error);
					}
				} else {
					await interaction.reply(v2Error);
				}
			} catch (replyErr) {
				ctx.logger.error({ err: replyErr }, "Failed to send interaction error reply");
			}
		}
	});

	return client;
}

async function onChatInput(interaction: ChatInputCommandInteraction, ctx: BotContext) {
	if (interaction.commandName !== "repo") return;
	await handleRepoCommand(interaction, ctx);
}

export async function registerCommands(
	client: Client,
	env: FullyConfiguredEnv,
	logger: Logger,
): Promise<void> {
	const body = [repoCommand.data.toJSON()];
	if (env.DISCORD_GUILD_ID) {
		const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
		await guild.commands.set(body);
		logger.info({ guildId: env.DISCORD_GUILD_ID }, "Registered guild slash commands");
		return;
	}
	await client.application?.commands.set(body);
	logger.info("Registered global slash commands");
}

export { repoCommand };
