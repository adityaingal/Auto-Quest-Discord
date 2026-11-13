import './utils/suppressWarnings';
import { createServer, Server } from 'node:http';
import {
	Client,
	Events,
	GatewayIntentBits,
	Interaction,
	InteractionType,
	MessageFlags,
} from 'discord.js';
import { loadConfig } from './config';
import { Logger } from './utils/logger';
import { createServices } from './services';
import { commands, registerCommands } from './commands/registry';
import { InteractionRouter } from './commands/interactions';
import { isAdmin } from './commands/admin';
import { roomAutocomplete } from './commands/room';
import { toUserMessage, AppError } from './utils/errors';
import { startHttpServer } from './httpServer';

/**
 * Whether the user may reach the operator level data. The check is done
 * without the interaction, so it also works for the autocomplete.
 */
function isOperator(
	userId: string,
	services: ReturnType<typeof createServices>,
): boolean {
	return services.scopeFor(userId).isOperator;
}

async function main(): Promise<void> {
	const config = loadConfig();
	Logger.setLevel(config.logLevel);

	Logger.info('Starting Discord Quest Completer bot...');

	const client = new Client({
		intents: [GatewayIntentBits.Guilds],
	});

	const services = createServices(config, client);
	services.registerCommands = () => registerCommands(client, config);

	const router = new InteractionRouter(services);
	const clients: Client[] = [client];

	/**
	 * Every bot instance (the primary one plus the additional tokens from
	 * /token add) handles interactions the same way.
	 */
	const attachInteractions = (target: Client) => {
		target.on('interactionCreate', async (interaction: Interaction) => {
			try {
				// The whitelist is checked for every kind of interaction, so
				// a blocked user cannot read anything through the autocomplete
				// or through a button.
				const access = services.adminService.checkAccess({
					userId: interaction.user.id,
					guildId: interaction.guildId,
					isAdmin: isAdmin({
						services,
						userId: interaction.user.id,
						member: interaction.member,
					}),
				});

				if (!access.allowed) {
					if (interaction.isAutocomplete()) {
						await interaction.respond([]);
						return;
					}

					if (interaction.isRepliable()) {
						await interaction.reply({
							content: `⛔ ${access.reason}`,
							flags: MessageFlags.Ephemeral,
						});
						return;
					}

					return;
				}

				if (interaction.isAutocomplete()) {
					await handleAutocomplete(interaction, services);
					return;
				}

				if (interaction.type === InteractionType.MessageComponent) {
					await router.handle(interaction);
					return;
				}

				if (!interaction.isChatInputCommand()) return;

				const command = commands.find(
					(entry) => entry.data.name === interaction.commandName,
				);

				if (!command) {
					await interaction.reply({
						content: 'Unknown command.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				if (
					services.adminService.isMaintenance() &&
					interaction.commandName !== 'admin'
				) {
					await interaction.reply({
						content:
							'The bot is in maintenance mode. Please try again later.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				await command.execute({
					interaction,
					services,
					userId: interaction.user.id,
					guildId: interaction.guildId,
					scope: services.scopeFor(interaction.user.id),
				});
			} catch (error) {
				// Expected errors (validation, permissions, unavailable
				// integrations) are normal user input problems - they get a
				// short log line, not a stack trace.
				if (error instanceof AppError) {
					Logger.info(
						`Interaction rejected (${error.code}): ${error.message}`,
					);
				} else {
					Logger.error(
						`Interaction failed: ${(error as Error).message}`,
						error instanceof Error ? error.stack : undefined,
					);
				}

				const message = toUserMessage(error);

				if (interaction.isRepliable()) {
					await interaction.reply({
						content: message,
						flags: MessageFlags.Ephemeral,
					});
				}
			}
		});
	};

	attachInteractions(client);

	let announced = false;

	const onReady = async () => {
		if (announced) return;
		announced = true;

		Logger.info(
			`Logged in as ${client.user?.tag ?? 'unknown'} (${client.user?.id ?? '?'})`,
		);
		Logger.info(
			`Loaded ${commands.length} slash commands: ${commands
				.map((command) => command.data.name)
				.join(', ')}`,
		);

		try {
			const count = await registerCommands(client, config);
			Logger.info(
				`Registered ${count} slash commands (${
					config.guildIds.length > 0
						? `guild scoped: ${config.guildIds.join(', ')}`
						: 'global - Discord can take up to an hour to show them'
				})`,
			);
		} catch (error) {
			Logger.error(
				`Slash command registration failed: ${(error as Error).message}`,
			);
		}
	};

	// discord.js v14.28 renamed the event to "clientReady"; older 14.x
	// versions only know "ready".
	if (Events.ClientReady) {
		client.once(Events.ClientReady, onReady);
	} else {
		client.once('ready', onReady);
	}

	client.on('error', (error) => {
		Logger.error(`Client error: ${error.message}`);
	});

	client.on('shardError', (error) => {
		Logger.error(`Shard error: ${error.message}`);
	});

	// The HTTP server (health check + OAuth2 callback) comes up first so the
	// hosting platform can reach it while the gateway handshake is still
	// running.
	const server = startHttpServer(config.port, services);

	if (config.redirectUri) {
		Logger.info(`OAuth2 redirect URI: ${config.redirectUri}`);
		Logger.info(
			'  -> it must be registered character for character under OAuth2 -> Redirects',
		);
	} else {
		Logger.warn(
			'DISCORD_REDIRECT_URI is not set - /account link is disabled.',
		);
	}

	Logger.info(`OAuth2 client id: ${config.clientId}`);

	// The user sessions that can read quests and run the automation.
	const operatorScope = services.scopeFor(config.ownerIds[0] ?? 'operator');
	const sessionLabels = services.autoService.accounts(operatorScope);
	if (sessionLabels.length > 0) {
		Logger.info(
			`User sessions available: ${sessionLabels.join(', ')}`,
		);

		const selected = services.autoService.defaultAccount(operatorScope);
		Logger.info(
			selected
				? `Selected account: ${selected} ("/quest switch account:all" uses every account again)`
				: 'No account selected - the quests of every account start at the same time.',
		);
	} else {
		Logger.warn(
			'No user session configured - /quest auto and /quest all stay disabled. ' +
				'Add one with "/room add" (per user) or "/token add <label> <token> user" (operator).',
		);
	}

	await client.login(config.botToken);

	// Only one bot instance answers the commands. An additional bot token
	// would register the same command names a second time, so every command
	// would show up twice in the Discord client and both bots would answer
	// the same interaction.

	services.notificationService.start(
		config.notificationIntervalMinutes,
	);

	Logger.info('Bot is ready.');

	const shutdown = async (signal: string) => {
		Logger.info(`Received ${signal}, shutting down...`);
		services.notificationService.stop();
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
		});
		for (const target of clients) {
			try {
				await target.destroy();
			} catch {
				// ignore
			}
		}
		services.database.close();
		Logger.info('Shutdown complete.');
		process.exit(0);
	};

	process.on('SIGINT', () => void shutdown('SIGINT'));
	process.on('SIGTERM', () => void shutdown('SIGTERM'));
	process.on('unhandledRejection', (reason) => {
		Logger.error(
			`Unhandled rejection: ${
				reason instanceof Error ? reason.message : String(reason)
			}`,
		);
	});
}

/**
 * Small HTTP server so hosting platforms can health check the process.
 */
/**
 * Autocomplete may not take longer than three seconds. Reading the live
 * quest list from Discord takes a moment, so the result is cached for a
 * minute and the dropdown is answered from the cache.
 */
let autocompleteCache: {
	quests: { id: string; name: string }[];
	fetchedAt: number;
} | null = null;

const AUTOCOMPLETE_TTL = 60_000;

async function handleAutocomplete(
	interaction: Interaction,
	services: ReturnType<typeof createServices>,
): Promise<void> {
	if (!interaction.isAutocomplete()) return;

	const started = Date.now();
	const focused = interaction.options.getFocused(true);
	const value = String(focused.value ?? '').trim();
	const scope = services.scopeFor(interaction.user.id);

	try {
		if (focused.name === 'quest') {
			const now = Date.now();

			if (!autocompleteCache || now - autocompleteCache.fetchedAt > AUTOCOMPLETE_TTL) {
				const { quests } = await services.questService.list(scope);

				autocompleteCache = {
					quests: quests.map((quest) => ({
						id: quest.id,
						name: quest.name,
					})),
					fetchedAt: now,
				};
			}

			const all = autocompleteCache.quests;
			const matches =
				value.length === 0
					? all
					: all.filter(
							(quest) =>
								quest.name.toLowerCase().includes(value.toLowerCase()) ||
								quest.id.includes(value),
						);

			// Discord rejects the whole response when two choices share a
			// name - several quests can have the same title, so the id is
			// appended when needed.
			const used = new Set<string>();
			const choices: { name: string; value: string }[] = [];

			for (const quest of matches.slice(0, 25)) {
				let label = quest.name.slice(0, 100);

				if (used.has(label)) {
					label = `${label.slice(0, 80)} (${quest.id.slice(-6)})`;
				}

				used.add(label);
				choices.push({ name: label, value: quest.id });
			}

			if (choices.length === 0) {
				// Discord rejects an empty choice list - offer the raw input
				// instead so a quest id can still be used.
				await interaction.respond([
					{ name: value.slice(0, 100), value: value.slice(0, 100) },
				]);
				return;
			}

			await interaction.respond(choices);

			const elapsed = Date.now() - started;
			if (elapsed > 1500) {
				Logger.warn(
					`Autocomplete for "quest" took ${elapsed}ms (limit 3000ms)`,
				);
			}

			return;
		}

		if (focused.name === 'account') {
			// Only the accounts of the caller are offered - the accounts of
			// the operator are never shown to anybody else.
			const accounts = services.autoService.accounts(scope);
			const choices: { name: string; value: string }[] = [];

			// "all" is always offered - it switches back to every account.
			if (
				value.length === 0 ||
				'all'.startsWith(value.toLowerCase())
			) {
				choices.push({ name: 'all (every account)', value: 'all' });
			}

			for (const account of accounts) {
				if (
					value.length === 0 ||
					account.toLowerCase().includes(value.toLowerCase())
				) {
					choices.push({ name: account.slice(0, 100), value: account });
				}
			}

			if (choices.length === 0) {
				await interaction.respond([
					{ name: value.slice(0, 100), value: value.slice(0, 100) },
				]);
				return;
			}

			await interaction.respond(choices.slice(0, 25));
			return;
		}

		if (focused.name === 'room') {
			const rooms = roomAutocomplete(
				services.roomService,
				interaction.user.id,
				value,
			);

			await interaction.respond(
				rooms.length
					? rooms
					: [{ name: value.slice(0, 100), value: value.slice(0, 100) }],
			);
			return;
		}

		if (focused.name === 'file') {
			// The backup files are only for admins - nobody else may even
			// see their names.
			if (!isOperator(interaction.user.id, services)) {
				await interaction.respond([]);
				return;
			}

			const files = services.adminService.backups().slice(0, 25);
			await interaction.respond(
				files.map((file) => ({ name: file, value: file })),
			);
			return;
		}

		await interaction.respond([]);
	} catch (error) {
		Logger.warn(
			`Autocomplete failed: ${(error as Error).message}`,
		);

		try {
			await interaction.respond([]);
		} catch {
			// the interaction is gone
		}
	}
}

// The OAuth2 redirect is handled by the HTTP server in ./httpServer.ts.

main().catch((error: unknown) => {
	Logger.error(
		`Fatal error: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(1);
});
