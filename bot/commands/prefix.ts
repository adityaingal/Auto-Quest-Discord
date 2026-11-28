import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	Message,
} from 'discord.js';
import { Services } from '../services';
import { isAdmin } from './admin';
import { Logger } from '../utils/logger';
import { AppError, toUserMessage } from '../utils/errors';
import {
	infoEmbed,
	successEmbed,
	errorEmbed,
	ownerPanelResultEmbed,
} from '../ui/embeds';
import { COLORS } from '../ui/theme';
import {
	buildOwnerPanel,
	buildOwnerProfilePanel,
	fetchOwnerPanelUser,
	OWNER_COMMANDS,
	OWNER_COMMAND_IDS,
	type PanelPayload,
} from '../ui/panel';

/**
 * Owner-only prefix commands.
 *
 * Public commands keep slash commands. The owner runs the maintenance and
 * admin commands with a prefix instead (for example `!admin stats`), which
 * keeps them out of the public command picker. Only the owner and the
 * configured admins are allowed to use these commands - everybody else is
 * ignored silently.
 */

type PrefixHandler = (
	message: Message,
	services: Services,
	scope: import('../services/scope').AccountScope,
	args: string[],
) => Promise<void>;

const PREFIX_HELP = [
	'`!help` - show this list',
	'`!panel [group]` - open the owner panel, optionally filtered',
	'`!profile [user id]` - open the user profile panel (avatar + username)',
	'',
	'Panels (owner + admins):',
	'`!room open` / `!token open` / `!admin open` - open that group panel',
	'`!whitelist open` / `!quest open` - open that group panel',
	'',
	'Rooms (owner + admins):',
	'`!room create <name> [description...]` - create a room',
	'`!room search <name>` - find one of your rooms',
	'`!room list` - list your rooms',
	'`!room add <room> <token>` - add an account to a room',
	'`!room remove <room> <slot>` - remove an account',
	'`!room delete <room>` - delete a room and its accounts',
	'`!room renew <room>` - reset the 30 day timer',
	'',
	'Tokens (owner + admins):',
	'`!token list [bot|user]` - list the stored tokens (masked)',
	'`!token add <label> <token> <bot|user>` - register a token',
	'`!token remove <id>` - delete a token',
	'`!token import [label]` - register the USER_TOKEN environment variable',
	'`!token check <id>` - validate a token against Discord',
	'',
	'Admin (owner + admins):',
	'`!admin setup` - show the setup status',
	'`!admin stats` - usage statistics',
	'`!admin users` - the known users',
	'`!admin logs` - the audit log',
	'`!admin reload` - reload the catalogue and configuration',
	'`!admin backup` - write a database backup',
	'`!admin restore <file>` - restore a backup',
	'`!admin webhook-backup [run|restore]` - upload or restore a verified snapshot',
	'`!admin settings` - show effective monitoring/media/membership/backup config',
	'`!admin maintenance` - toggle maintenance mode',
	'`!admin config <key> <value>` - write a configuration value',
	'`!admin purge <user>` - delete every piece of data of a user',
	'',
	'Whitelist (owner + admins):',
	'`!whitelist list` - show the whitelisted servers and users',
	'`!whitelist add <guild|user> <id> [label] [member|admin]` - allow a server or user',
	'`!whitelist remove <guild|user> <id>` - remove it',
	'`!whitelist role <guild|user> <id> <member|admin>` - change the access role',
	'`!whitelist enable` / `!whitelist disable` - turn the restriction on or off',
	'`!whitelist sync` - add every server the bot is in to the whitelist',
	'',
	'Automation (owner + admins):',
	'`!quest auto <quest>` - complete one quest with the operator accounts',
	'`!quest all [stop]` - run every account, or stop the running queue',
] as const;

/** Hand-written args parser that keeps quoted groups together. */
function tokenize(text: string): string[] {
	const tokens: string[] = [];
	const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(text)) !== null) {
		tokens.push(match[1] ?? match[2] ?? match[3]);
	}

	return tokens;
}

function reply(
	message: Message,
	embed: EmbedBuilder,
): Promise<Message | null> {
	return message
		.reply({ embeds: [embed] })
		.catch(() => null);
}

export async function handlePrefixCommand(
	message: Message,
	services: Services,
): Promise<void> {
	// Bots never use the owner/admin prefix commands.
	if (message.author.bot) return;

	const raw = message.content.trim();
	const prefix = services.config.prefix;
	if (!raw.startsWith(prefix)) return;
	if (
		!services.config.ownerIds.includes(message.author.id) &&
		!isAdmin({
			services,
			userId: message.author.id,
			member: message.member,
		})
	) {
		return;
	}

	const tokens = tokenize(raw.slice(prefix.length).trim());
	if (tokens.length === 0) return;

	const [group, ...rest] = tokens;
	const scope = services.scopeFor(message.author.id);

	try {
		switch (group) {
			case 'help': {
				await message
					.reply({
						embeds: [
							new EmbedBuilder()
								.setColor(COLORS.primary)
								.setTitle('OWNER COMMANDS')
								.setDescription(PREFIX_HELP.join('\n')),
						],
					})
					.catch(() => undefined);
				return;
			}

			case 'panel': {
				await openOwnerPanel(message, rest[0]);
				return;
			}

			case 'profile': {
				await handleProfile(message, services, rest[0]);
				return;
			}

			case 'room': {
				const [sub, ...args] = rest;
				await handleRoom(message, services, args, sub);
				return;
			}

			case 'token': {
				const [sub, ...args] = rest;
				await handleToken(message, services, args, sub);
				return;
			}

			case 'admin': {
				const [sub, ...args] = rest;
				await handleAdmin(message, services, args, sub, scope);
				return;
			}

			case 'whitelist': {
				const [sub, ...args] = rest;
				await handleWhitelist(message, services, args, sub);
				return;
			}

			case 'quest': {
				const [sub, ...args] = rest;
				await handleQuest(message, services, args, sub, scope);
				return;
			}

			default: {
				await message
					.reply(
						`Unknown prefix command. Use \`${services.config.prefix}help\` to see the list.`,
					)
					.catch(() => undefined);
			}
		}
	} catch (error) {
		if (error instanceof AppError) {
			Logger.info(`Prefix command rejected: ${error.message}`);
		} else {
			Logger.error(
				`Prefix command failed: ${(error as Error).message}`,
			);
		}

		await message
			.reply(toUserMessage(error))
			.catch(() => undefined);
	}
}

type OwnerRunResult = { embeds: EmbedBuilder[]; text: string };

/** Captures the replies of an existing prefix handler for the panel view. */
function captureOwnerMessage(ownerId: string): {
	message: Message;
	parts: string[];
	embeds: EmbedBuilder[];
} {
	const parts: string[] = [];
	const embeds: EmbedBuilder[] = [];
	const message = {
		author: { id: ownerId },
		channel: {
			send: async (content: string) => {
				parts.push(String(content));
				return null;
			},
		},
		reply: async (options: unknown) => {
			if (typeof options === 'string') {
				parts.push(options);
			} else {
				const payload = options as {
					content?: string;
					embeds?: EmbedBuilder[];
				};
				if (payload.content) parts.push(payload.content);
				if (payload.embeds) embeds.push(...payload.embeds);
			}
			return null;
		},
	} as unknown as Message;

	return { message, parts, embeds };
}

/** Runs an owner command from the panel using the text-command handlers. */
export async function runOwnerPanelCommand(
	services: Services,
	ownerId: string,
	id: string,
	args: string[],
): Promise<OwnerRunResult> {
	const { message, parts, embeds } = captureOwnerMessage(ownerId);
	const scope = services.scopeFor(ownerId);

	try {
		switch (id) {
			case 'profile':
				await handleProfile(message, services, args[0]);
				break;
			case 'room.create':
				await handleRoom(message, services, ['create', ...args], 'create');
				break;
			case 'room.search':
				await handleRoom(message, services, ['search', ...args], 'search');
				break;
			case 'room.list':
				await handleRoom(message, services, ['list'], 'list');
				break;
			case 'room.add':
				await handleRoom(message, services, ['add', ...args], 'add');
				break;
			case 'room.remove':
				await handleRoom(message, services, ['remove', ...args], 'remove');
				break;
			case 'room.delete':
				await handleRoom(message, services, ['delete', ...args], 'delete');
				break;
			case 'room.renew':
				await handleRoom(message, services, ['renew', ...args], 'renew');
				break;
			case 'token.list':
				await handleToken(message, services, ['list', ...args], 'list');
				break;
			case 'token.add':
				await handleToken(message, services, ['add', ...args], 'add');
				break;
			case 'token.import':
				await handleToken(message, services, ['import', ...args], 'import');
				break;
			case 'token.remove':
				await handleToken(message, services, ['remove', ...args], 'remove');
				break;
			case 'token.check':
				await handleToken(message, services, ['check', ...args], 'check');
				break;
			case 'admin.setup':
				await handleAdmin(message, services, ['setup'], 'setup', scope);
				break;
			case 'admin.stats':
				await handleAdmin(message, services, ['stats'], 'stats', scope);
				break;
			case 'admin.users':
				await handleAdmin(message, services, ['users'], 'users', scope);
				break;
			case 'admin.logs':
				await handleAdmin(message, services, ['logs'], 'logs', scope);
				break;
			case 'admin.reload':
				await handleAdmin(message, services, ['reload'], 'reload', scope);
				break;
			case 'admin.backup':
				await handleAdmin(message, services, ['backup'], 'backup', scope);
				break;
			case 'admin.restore':
				await handleAdmin(message, services, ['restore', ...args], 'restore', scope);
				break;
			case 'admin.webhook-backup':
				await handleAdmin(
					message,
					services,
					['webhook-backup', ...args],
					'webhook-backup',
					scope,
				);
				break;
			case 'admin.settings':
				await handleAdmin(message, services, ['settings'], 'settings', scope);
				break;
			case 'admin.maintenance':
				await handleAdmin(message, services, ['maintenance'], 'maintenance', scope);
				break;
			case 'admin.config':
				await handleAdmin(message, services, ['config', ...args], 'config', scope);
				break;
			case 'admin.purge':
				await handleAdmin(message, services, ['purge', ...args], 'purge', scope);
				break;
			case 'whitelist.list':
				await handleWhitelist(message, services, ['list'], 'list');
				break;
			case 'whitelist.add':
				await handleWhitelist(message, services, ['add', ...args], 'add');
				break;
			case 'whitelist.remove':
				await handleWhitelist(message, services, ['remove', ...args], 'remove');
				break;
			case 'whitelist.role':
				await handleWhitelist(message, services, ['role', ...args], 'role');
				break;
			case 'whitelist.enable':
				await handleWhitelist(message, services, ['enable'], 'enable');
				break;
			case 'whitelist.disable':
				await handleWhitelist(message, services, ['disable'], 'disable');
				break;
			case 'whitelist.sync':
				await handleWhitelist(message, services, ['sync'], 'sync');
				break;
			case 'quest.auto':
				await handleQuest(message, services, ['auto', ...args], 'auto', scope);
				break;
			case 'quest.all':
				await handleQuest(message, services, ['all'], 'all', scope);
				break;
			case 'quest.stop':
				await handleQuest(message, services, ['stop'], 'stop', scope);
				break;
			default:
				embeds.push(errorEmbed('Unknown owner command.'));
		}
	} catch (error) {
		embeds.push(errorEmbed(toUserMessage(error)));
	}

	return { embeds, text: parts.join('\n\n') };
}

async function openOwnerPanel(
	message: Message,
	group?: string,
): Promise<void> {
	const payload = buildOwnerPanel(0, group);
	await message
		.reply({
			embeds: payload.embeds,
			components: payload.components,
		})
		.catch(() => null);
}

/** Wraps the captured result with the panel's own embed and navigation. */
export function buildOwnerPanelResult(
	id: string,
	result: OwnerRunResult,
	group?: string,
): PanelPayload {
	const label = OWNER_COMMANDS.find((entry) => entry.id === id)?.label ?? id;
	const text = result.text || 'Command completed.';

	return {
		embeds: [ownerPanelResultEmbed(label, text), ...result.embeds].slice(0, 10),
		components: [
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(
						group
							? `${OWNER_COMMAND_IDS.again}:${group}:${id}`
							: `${OWNER_COMMAND_IDS.again}:${id}`,
					)
					.setLabel('Run Again')
					.setStyle(ButtonStyle.Primary),
				new ButtonBuilder()
					.setCustomId(
						group
							? `${OWNER_COMMAND_IDS.back}:${group}`
							: OWNER_COMMAND_IDS.back,
					)
					.setLabel('Back to Commands')
					.setStyle(ButtonStyle.Secondary),
			),
		],
	};
}

/** Opens the owner profile panel, optionally with a user id already set. */
async function handleProfile(
	message: Message,
	services: Services,
	rawUserId: string | undefined,
): Promise<void> {
	const user = await fetchOwnerPanelUser(services, rawUserId);
	const hint = rawUserId && !user
		? 'No Discord user found for that id. Press **Enter User ID** to try again.'
		: undefined;
	const payload = buildOwnerProfilePanel(user, hint);

	await message
		.reply({ embeds: payload.embeds, components: payload.components })
		.catch(() => null);
}

async function handleRoom(
	message: Message,
	services: Services,
	args: string[],
	sub: string | undefined,
): Promise<void> {
	const ownerId = message.author.id;
	const rest = args.slice(1);

	switch (sub) {
		case 'open': {
			await openOwnerPanel(message, 'room');
			return;
		}
		case 'create': {
			const name = args[1];
			if (!name) {
				await message.reply('Usage: `!room create <name> [description...]`');
				return;
			}

			const room = await services.roomService.create(
				ownerId,
				name,
				args.slice(2).join(' ').trim() || null,
			);

			await reply(
				message,
				successEmbed(
					`The room **${room.name}** was created. It is reset automatically on **${new Date(
						room.expiresAt,
					).toUTCString()}**.`,
				),
			);
			return;
		}

		case 'search': {
			const query = rest.join(' ').trim();
			if (!query) {
				await message.reply('Usage: `!room search <name>`');
				return;
			}

			const rooms = services.roomService.find(ownerId, query);

			await reply(
				message,
				rooms.length
					? infoEmbed(
							'YOUR ROOMS',
							rooms
								.map(
									(room) =>
										`**${room.name}** - ${room.accounts.length} account(s) - resets ${new Date(
											room.expiresAt,
										).toUTCString()}`,
								)
								.join('\n'),
						)
					: errorEmbed(`No room matches "${query}".`),
			);
			return;
		}

		case 'list': {
			const rooms = services.roomService.list(ownerId);

			await reply(
				message,
				rooms.length
					? infoEmbed(
							'YOUR ROOMS',
							rooms
								.map(
									(room) =>
										`**${room.name}** - ${room.accounts.length} account(s) - resets ${new Date(
											room.expiresAt,
										).toUTCString()}`,
								)
								.join('\n'),
						)
					: infoEmbed('YOUR ROOMS', 'You do not have any rooms yet.'),
			);
			return;
		}

		case 'add': {
			const roomName = args[1];
			const token = args[2];

			if (!roomName || !token) {
				await message.reply('Usage: `!room add <room> <token>`');
				return;
			}

			const account = await services.roomService.addAccount(
				ownerId,
				roomName,
				token,
				(raw) => services.tokenService.check(raw, 'user'),
			);

			await reply(
				message,
				successEmbed(
					`Added **${account.accountUsername ?? 'unknown'}** to **${roomName}** in slot **${account.slot}**.`,
				),
			);
			return;
		}

		case 'remove': {
			const roomName = args[1];
			const slot = Number(args[2]);

			if (!roomName || !Number.isFinite(slot)) {
				await message.reply('Usage: `!room remove <room> <slot>`');
				return;
			}

			const result = services.roomService.removeAccount(
				ownerId,
				roomName,
				slot,
			);

			await reply(
				message,
				successEmbed(
					`Removed **${result.removed.accountUsername ?? 'the account'}** from slot **${slot}**. The slots were closed up.`,
				),
			);
			return;
		}

		case 'delete': {
			const roomName = rest.join(' ').trim();
			if (!roomName) {
				await message.reply('Usage: `!room delete <room>`');
				return;
			}

			const removed = services.roomService.delete(ownerId, roomName);

			await reply(
				message,
				removed
					? successEmbed(`The room **${roomName}** and every account in it were deleted.`)
					: errorEmbed(`There is no room called "${roomName}".`),
			);
			return;
		}

		case 'renew': {
			const roomName = rest.join(' ').trim();
			if (!roomName) {
				await message.reply('Usage: `!room renew <room>`');
				return;
			}

			const room = services.roomService.renew(ownerId, roomName);

			await reply(
				message,
				successEmbed(
					`The room **${room.name}** now resets on **${new Date(
						room.expiresAt,
					).toUTCString()}**.`,
				),
			);
			return;
		}

		default:
			await message.reply(
				'Usage: `!room create|search|list|add|remove|delete|renew` - use `!help` to see the details.',
			);
	}
}

async function handleToken(
	message: Message,
	services: Services,
	args: string[],
	sub: string | undefined,
): Promise<void> {
	switch (sub) {
		case 'open': {
			await openOwnerPanel(message, 'token');
			return;
		}
		case 'list': {
			const type =
				args[1] as 'bot' | 'user' | undefined;
			const tokens = services.tokenService
				.list()
				.filter(
					(token) => !type || token.type === type,
				);

			const lines = tokens
				.map(
					(token) =>
						`\`#${token.id}\` **${token.label}** - ${token.type} - ${
							token.botUsername ?? token.accountUsername ?? 'unknown'
						} (${token.botUserId ?? token.accountId ?? '?'})\n` +
						`status: ${token.status} - fingerprint \`${token.fingerprint}\``,
				)
				.join('\n\n');

			await reply(
				message,
				tokens.length
					? infoEmbed(`TOKENS (${tokens.length})`, lines.slice(0, 4000))
					: infoEmbed('TOKENS', 'No tokens stored.'),
			);
			return;
		}

		case 'add': {
			const label = args[1];
			const token = args[2];
			const type = args[3] as 'bot' | 'user' | undefined;

			if (!label || !token || (type !== 'bot' && type !== 'user')) {
				await message.reply(
					'Usage: `!token add <label> <token> <bot|user>`',
				);
				return;
			}

			const record = await services.tokenService.add(
				label,
				token,
				type,
			);

			await reply(
				message,
				successEmbed(
					`Registered the **${record.type}** token \`${record.label}\` for ${record.botUsername ?? record.accountUsername ?? 'unknown'} (\`${record.masked}\`).`,
				),
			);
			return;
		}

		case 'import': {
			const fromEnv = process.env.USER_TOKEN?.trim();
			if (!fromEnv) {
				await message.reply(
					'USER_TOKEN is not set in the environment.',
				);
				return;
			}

			const label = args[1]?.trim() || 'USER_TOKEN';

			const record = await services.tokenService.add(
				label,
				fromEnv,
				'user',
			);

			await reply(
				message,
				successEmbed(
					`Imported USER_TOKEN as **${record.label}** (${record.accountUsername ?? 'unknown'}).`,
				),
			);
			return;
		}

		case 'remove': {
			const id = Number(args[1]);
			if (!Number.isFinite(id)) {
				await message.reply('Usage: `!token remove <id>`');
				return;
			}

			const removed = services.tokenService.remove(id);

			await reply(
				message,
				removed
					? successEmbed(`Removed token #${id}.`)
					: errorEmbed(`There is no token with the id ${id}.`),
			);
			return;
		}

		case 'check': {
			const id = Number(args[1]);
			if (!Number.isFinite(id)) {
				await message.reply('Usage: `!token check <id>`');
				return;
			}

			const check = await services.tokenService.revalidate(id);

			await reply(
				message,
				new EmbedBuilder()
					.setColor(check.valid ? COLORS.success : COLORS.danger)
					.setTitle(check.valid ? 'TOKEN VALID' : 'TOKEN INVALID')
					.setDescription(check.message),
			);
			return;
		}

		default:
			await message.reply(
				'Usage: `!token list|add|remove|import|check` - use `!help` for the details.',
			);
	}
}

async function handleAdmin(
	message: Message,
	services: Services,
	args: string[],
	sub: string | undefined,
	scope: import('../services/scope').AccountScope,
): Promise<void> {
	const rest = args.slice(1);

	switch (sub) {
		case 'open': {
			await openOwnerPanel(message, 'admin');
			return;
		}
		case 'setup': {
			const registered = services.registerCommands
				? await services.registerCommands()
				: null;

			await reply(
				message,
				infoEmbed('SETUP', 'Everything the bot needs in order to run.', [
					{
						name: 'Slash commands',
						value: registered
							? `registered (${registered} commands)`
							: 'registration is handled on startup',
					},
					{
						name: 'OAuth2 linking',
						value: services.accountService.oauthEnabled
							? 'configured'
							: 'not configured - use DISCORD_CLIENT_SECRET and DISCORD_REDIRECT_URI',
					},
					{
						name: 'Database',
						value: services.config.databasePath,
					},
					{
						name: 'Quest catalogue',
						value: services.config.questCatalogPath,
					},
					{
						name: 'Owner ids',
						value: services.config.ownerIds.join(', ') || 'none',
					},
				]),
			);
			return;
		}

		case 'stats': {
			const stats = services.adminService.stats();

			await reply(
				message,
				infoEmbed('STATISTICS', 'Bot usage at a glance.', [
					{ name: 'Users', value: String(stats.users) },
					{ name: 'Linked accounts', value: String(stats.links) },
					{ name: 'Quests tracked', value: String(stats.quests) },
					{ name: 'Progress rows', value: String(stats.progressRows) },
					{ name: 'History rows', value: String(stats.historyRows) },
					{ name: 'Uptime', value: `${Math.floor(stats.uptimeSeconds / 60)}m ${stats.uptimeSeconds % 60}s` },
					{ name: 'Memory', value: `${stats.memoryMb} MB` },
				]),
			);
			return;
		}

		case 'users': {
			const users = services.adminService.users(25);
			const lines = users.length
				? users
						.map(
							(user) =>
								`\`${user.discord_user_id}\` - ${user.username ?? 'unknown'} - joined ${user.created_at}`,
						)
						.join('\n')
				: 'No users yet.';

			await reply(
				message,
				infoEmbed('USERS', lines.slice(0, 4000)),
			);
			return;
		}

		case 'logs': {
			const logs = services.adminService.logs(25);
			const lines = logs.length
				? logs
						.map(
							(log) =>
								`\`${log.created_at}\` **${log.action}** by ${log.actor_id ?? 'system'} ${log.detail ?? ''}`,
						)
						.join('\n')
				: 'The audit log is empty.';

			await reply(
				message,
				infoEmbed('ADMIN LOG', lines.slice(0, 4000)),
			);
			return;
		}

		case 'reload': {
			const result =
				await services.questService.refresh(scope);
			services.adminService.audit(
				scope.userId,
				'reload',
				`${result.quests.length} quests from ${result.source}`,
			);

			await reply(
				message,
				successEmbed(
					`Reloaded **${result.quests.length}** quests from the **${result.source}** source.`,
				),
			);
			return;
		}

		case 'backup': {
			const path = services.adminService.backup();
			services.adminService.audit(scope.userId, 'backup', path);

			await reply(
				message,
				successEmbed(`Backup written to \`${path}\`.`),
			);
			return;
		}

		case 'restore': {
			const file = rest.join(' ').trim();
			if (!file) {
				await message.reply('Usage: `!admin restore <file>`');
				return;
			}

			const source = services.adminService.restore(file);
			services.adminService.audit(scope.userId, 'restore', source);

			await reply(
				message,
				successEmbed(`Database restored from \`${source}\`.`),
			);
			return;
		}

		case 'webhook-backup': {
			const action = (rest[0] ?? 'run').toLowerCase();

			if (action === 'restore') {
				const result = await services.webhookBackupService.restore(
					scope.userId,
				);
				await reply(
					message,
					successEmbed(
						`Restored from the verified webhook snapshot. A safety copy is at \`${result.path}\`; ${result.historyRows} permanent record(s) were preserved.`,
					),
				);
				return;
			}

			if (action !== 'run') {
				await message.reply(
					'Usage: `!admin webhook-backup [run|restore]`',
				);
				return;
			}

			services.adminService.audit(scope.userId, 'webhook_backup', 'manual');
			const result = await services.webhookBackupService.run();
			await reply(
				message,
				infoEmbed('WEBHOOK BACKUP', `Status: **${result.status}**.`, [
					{
						name: 'Detail',
						value: result.reason ?? result.messageId ?? result.hash?.slice(0, 16) ?? 'none',
					},
				]),
			);
			return;
		}

		case 'settings': {
			const effective = services.adminService.runtimeSettings();
			const fields = Object.entries({
				...effective,
				webhook_backup_max_mb: Math.floor(
					effective.webhookBackupMaxBytes / (1024 * 1024),
				),
				database_path: services.config.databasePath,
				webhook_configured: services.config.webhookUrl ? 'true' : 'false',
			}).map(([key, value]) => ({
				name: key,
				value: String(value).slice(0, 1024),
				inline: true,
			}));

			await reply(
				message,
				infoEmbed(
					'EFFECTIVE SETTINGS',
					'Environment defaults with any `!admin config` overrides applied.',
					fields.slice(0, 25),
				),
			);
			return;
		}

		case 'maintenance': {
			const enabled = !services.adminService.isMaintenance();

			services.adminService.setMaintenance(enabled);
			services.adminService.audit(
				scope.userId,
				'maintenance',
				enabled ? 'on' : 'off',
			);

			await reply(
				message,
				successEmbed(
					`Maintenance mode is now **${enabled ? 'on' : 'off'}**.`,
				),
			);
			return;
		}

		case 'config': {
			const key = args[1];
			const value = args.slice(2).join(' ').trim();

			if (!key || !value) {
				await message.reply(
					'Usage: `!admin config <key> <value>`',
				);
				return;
			}

			services.adminService.setConfig(key, value);
			services.adminService.audit(
				scope.userId,
				'config',
				`${key}=${value}`,
			);

			await reply(
				message,
				successEmbed(`\`${key}\` is now \`${value}\`.`),
			);
			return;
		}

		case 'purge': {
			const userId = args[1];
			if (!userId || !/^\d{15,25}$/.test(userId)) {
				await message.reply(
					'Usage: `!admin purge <user id>` (17-20 digits)',
				);
				return;
			}

			services.repositories.purgeUser(userId);
			services.adminService.audit(scope.userId, 'purge_user', userId);

			await reply(
				message,
				successEmbed(
					`Every piece of data of \`${userId}\` was deleted - the link, the rooms, the progress, the history and the rewards.`,
				),
			);
			return;
		}

		default:
			await message.reply(
				'Usage: `!admin setup|stats|users|logs|reload|backup|restore|webhook-backup|settings|maintenance|config|purge` - use `!help` for the details.',
			);
	}
}

async function handleWhitelist(
	message: Message,
	services: Services,
	args: string[],
	sub: string | undefined,
): Promise<void> {
	switch (sub) {
		case 'open': {
			await openOwnerPanel(message, 'whitelist');
			return;
		}
		case 'list': {
			const entries = services.adminService.whitelist();
			const enabled = services.adminService.isWhitelistEnabled();
			const lines = entries.length
				? entries
						.map(
							(entry) =>
								`\`${entry.kind}\` **${entry.label ?? entry.entry_id}** - role: **${entry.role}** - \`${entry.entry_id}\``,
						)
						.join('\n')
				: 'The whitelist is empty.';

			await reply(
				message,
				infoEmbed(
					'WHITELIST',
					`The whitelist is **${enabled ? 'active' : 'inactive'}**.\n\n${lines}`.slice(
						0,
						4000,
					),
				),
			);
			return;
		}

		case 'add': {
			const kind = args[1] as 'guild' | 'user' | undefined;
			const id = args[2];
			const label = args[3] ?? null;
			const role = (args[4] as 'member' | 'admin' | undefined) ?? 'member';

			if (!kind || !id || (kind !== 'guild' && kind !== 'user')) {
				await message.reply(
					'Usage: `!whitelist add <guild|user> <id> [label] [member|admin]`',
				);
				return;
			}

			if (role !== 'member' && role !== 'admin') {
				await message.reply('The role has to be `member` or `admin`.');
				return;
			}

			services.adminService.addWhitelist(
				kind,
				id,
				label,
				message.author.id,
				role,
			);

			await reply(
				message,
				successEmbed(
					`Added the ${kind} \`${id}\` to the whitelist with the **${role}** role.`,
				),
			);
			return;
		}

		case 'remove': {
			const kind = args[1] as 'guild' | 'user' | undefined;
			const id = args[2];

			if (!kind || !id || (kind !== 'guild' && kind !== 'user')) {
				await message.reply(
					'Usage: `!whitelist remove <guild|user> <id>`',
				);
				return;
			}

			const removed = services.adminService.removeWhitelist(kind, id);

			await reply(
				message,
				removed
					? successEmbed(
							`Removed the ${kind} \`${id}\` from the whitelist.`,
						)
					: errorEmbed(`\`${id}\` was not on the whitelist.`),
			);
			return;
		}

		case 'role': {
			const kind = args[1] as 'guild' | 'user' | undefined;
			const id = args[2];
			const role = args[3] as 'member' | 'admin' | undefined;

			if (
				!kind ||
				!id ||
				(kind !== 'guild' && kind !== 'user') ||
				(role !== 'member' && role !== 'admin')
			) {
				await message.reply(
					'Usage: `!whitelist role <guild|user> <id> <member|admin>`',
				);
				return;
			}

			services.adminService.setWhitelistRole(kind, id, role);

			await reply(
				message,
				successEmbed(
					`The ${kind} \`${id}\` now has the **${role}** role.`,
				),
			);
			return;
		}

		case 'enable': {
			services.adminService.setWhitelistEnabled(true);
			services.adminService.audit(
				message.author.id,
				'whitelist_enable',
				null,
			);

			await reply(
				message,
				successEmbed(
					'The whitelist is active - only the listed servers and users may use the bot.',
				),
			);
			return;
		}

		case 'disable': {
			services.adminService.setWhitelistEnabled(false);
			services.adminService.audit(
				message.author.id,
				'whitelist_disable',
				null,
			);

			await reply(
				message,
				successEmbed(
					'The whitelist is inactive - everybody can use the bot.',
				),
			);
			return;
		}

		case 'sync': {
			const guilds = (await services.client.rest.get(
				'/users/@me/guilds',
			)) as { id: string; name: string }[];

			for (const guild of guilds ?? []) {
				services.adminService.addWhitelist(
					'guild',
					guild.id,
					guild.name,
					message.author.id,
				);
			}

			services.adminService.audit(
				message.author.id,
				'whitelist_sync',
				`${guilds?.length ?? 0} guilds`,
			);

			await reply(
				message,
				successEmbed(
					`Added **${guilds?.length ?? 0}** server(s) to the whitelist.`,
				),
			);
			return;
		}

		default:
			await message.reply(
				'Usage: `!whitelist list|add|remove|role|enable|disable|sync` - use `!help` for the details.',
			);
	}
}

async function handleQuest(
	message: Message,
	services: Services,
	args: string[],
	sub: string | undefined,
	scope: import('../services/scope').AccountScope,
): Promise<void> {
	if (sub === 'open') {
		await openOwnerPanel(message, 'quest');
		return;
	}

	if (sub === 'stop') {
		services.autoService.requestStop(scope);
		await reply(
			message,
			successEmbed('The running queue will stop after the current quest.'),
		);
		return;
	}

	if (sub === 'all') {
		if (!services.autoService.enabled(scope)) {
			await message.reply(
				'The automation is disabled. Add an account with `!room add` first.',
			);
			return;
		}

		if (services.autoService.isRunning(scope)) {
			await message.reply(
				'A quest queue is already running - use `!quest stop` to stop it.',
			);
			return;
		}

		const plan = await services.autoService.planQueue(scope, {});

		const accounts = [...new Set(plan.map((job) => job.account))];

		await message.reply(
			`Starting the queue with **${plan.length}** quest(s) on **${accounts.length}** account(s). This takes a while - the result DMs when it is done.`,
		);

		const summary = await services.autoService.runAll(scope, undefined, {
			plan,
		});

		if ('send' in message.channel) {
			await message.channel.send(
				[
					'🏁 **Quest queue done**',
					`Completed: ${summary.completed}`,
					`Failed: ${summary.failed}`,
					`Skipped: ${summary.skipped}`,
					'',
					...summary.results.map(
						(result) =>
							`${result.finished ? '✅' : '⚠️'} **${result.account}** - ${result.quest}: ${result.message}`,
					),
				].join('\n').slice(0, 1900),
			);
		}

		return;
	}

	if (sub === 'auto') {
		const questId = args[1];
		if (!questId) {
			await message.reply('Usage: `!quest auto <quest id or name>`');
			return;
		}

		if (!services.autoService.enabled(scope)) {
			await message.reply(
				'The automation is disabled. Add an account with `!room add` first.',
			);
			return;
		}

		const plan = await services.autoService.planQueue(scope, {
			quest: questId,
		});

		if (plan.length === 0) {
			await message.reply(
				'That quest is not available for any of your accounts.',
			);
			return;
		}

		const accounts = [...new Set(plan.map((job) => job.account))];

		await message.reply(
			`Working on **${questId}** on **${accounts.join(', ')}** - this can take a while. The result DMs when it is done.`,
		);

		const summary = await services.autoService.runAll(scope, undefined, {
			account: null,
			quest: questId,
			plan,
		});

		if ('send' in message.channel) {
			await message.channel.send(
				[
					'🏁 **Quest auto done**',
					`Completed: ${summary.completed}`,
					`Failed: ${summary.failed}`,
					`Skipped: ${summary.skipped}`,
					'',
					...summary.results.map(
						(result) =>
							`${result.finished ? '✅' : '⚠️'} **${result.account}** - ${result.quest}: ${result.message}`,
					),
				].join('\n').slice(0, 1900),
			);
		}

		return;
	}

	await message.reply('Usage: `!quest auto|all|stop` - use `!help` for the details.');
}
