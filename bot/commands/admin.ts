import {
	ChannelType,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandSubcommandBuilder,
} from 'discord.js';
import { CommandContext, CommandDefinition, group } from './types';
import { infoEmbed, successEmbed, errorEmbed } from '../ui/embeds';
import { PermissionError } from '../utils/errors';
import { buildMaintenanceRow } from '../ui/components';
import { Services } from '../services';

/**
 * What the admin check needs. The member is passed separately, so the check
 * works for a chat command, for a button and for the autocomplete.
 */
export type AdminCheck = {
	services: Services;
	userId: string;
	/** The guild member that ran the interaction, if there is one. */
	member?: unknown;
};

export function isAdmin(context: AdminCheck): boolean {
	const { services, userId, member } = context;

	if (services.config.ownerId && userId === services.config.ownerId) {
		return true;
	}

	// A whitelisted user with the "admin" role is treated as an admin.
	if (services.adminService.isWhitelistedAdmin(userId)) {
		return true;
	}

	const adminRoleId = services.config.adminRoleId;
	if (!adminRoleId) return false;
	if (!member || typeof member !== 'object') return false;

	// The member is either a GuildMember (a cache collection) or the raw API
	// shape (an array of role ids).
	if (!('roles' in member)) return false;

	const roles = (member as { roles: unknown }).roles;

	if (Array.isArray(roles)) {
		return roles.includes(adminRoleId);
	}

	if (roles && typeof roles === 'object' && 'cache' in roles) {
		const cache = (roles as { cache: { has(id: string): boolean } }).cache;
		return cache.has(adminRoleId);
	}

	return false;
}

export function assertAdmin(context: CommandContext): void {
	if (!isAdmin({
		services: context.services,
		userId: context.userId,
		member: context.interaction.member,
	})) {
		throw new PermissionError(
			'Only the bot owner or the configured admin role can use this command.',
		);
	}
}
function adminOption(sub: SlashCommandSubcommandBuilder): void {
	sub.addStringOption((option) =>
		option
			.setName('key')
			.setDescription('Configuration key')
			.setRequired(true),
	);
	sub.addStringOption((option) =>
		option
			.setName('value')
			.setDescription('New value')
			.setRequired(true),
	);
}

export const adminCommand: CommandDefinition = group(
	'admin',
	'Owner and admin operations.',
	[
		{
			name: 'setup',
			description: 'Show the setup status and register the slash commands.',
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				assertAdmin(context);

				const channelId =
					interaction.channelId && interaction.channel?.type ===
						ChannelType.GuildText
						? interaction.channelId
						: null;

				if (channelId && interaction.guildId) {
					services.repositories.setGuildChannel(
						interaction.guildId,
						channelId,
					);
				}

				const registered = context.services.registerCommands
					? await context.services.registerCommands()
					: null;

				await interaction.reply({
					embeds: [
						infoEmbed(
							'SETUP',
							'Everything the bot needs in order to run.',
							[
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
										: 'not configured - `/account link` is disabled',
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
									name: 'Notification channel',
									value: channelId ?? 'not set',
								},
						{
							name: 'User sessions',
							value:
								services.autoService
									.accounts(services.scopeFor(userId))
									.join(', ') ||
								'none - /quest auto stays disabled',
						},
						{
							name: 'Selected account',
							value:
								services.autoService.defaultAccount(
									services.scopeFor(userId),
								) ??
								'none - every account is used at the same time',
						},
							],
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'stats',
			description: 'Show usage statistics.',
			run: async (context: CommandContext) => {
				assertAdmin(context);
				const stats = context.services.adminService.stats();

				await context.interaction.reply({
					embeds: [
						infoEmbed('STATISTICS', 'Bot usage at a glance.', [
							{
								name: 'Users',
								value: String(stats.users),
							},
							{
								name: 'Linked accounts',
								value: String(stats.links),
							},
							{
								name: 'Quests tracked',
								value: String(stats.quests),
							},
							{
								name: 'Progress rows',
								value: String(stats.progressRows),
							},
							{
								name: 'History rows',
								value: String(stats.historyRows),
							},
							{
								name: 'Uptime',
								value: `${Math.floor(stats.uptimeSeconds / 60)}m ${stats.uptimeSeconds % 60}s`,
							},
							{
								name: 'Memory',
								value: `${stats.memoryMb} MB`,
							},
						]),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'users',
			description: 'List the users of this bot.',
			run: async (context: CommandContext) => {
				assertAdmin(context);
				const users = context.services.adminService.users(25);

				const lines = users.length
					? users
							.map(
								(user) =>
									`\`${user.discord_user_id}\` - ${
										user.username ?? 'unknown'
									} - joined ${user.created_at}`,
							)
							.join('\n')
					: 'No users yet.';

				await context.interaction.reply({
					embeds: [infoEmbed('USERS', lines.slice(0, 4000))],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'logs',
			description: 'Show the admin audit log.',
			run: async (context: CommandContext) => {
				assertAdmin(context);
				const logs = context.services.adminService.logs(25);

				const lines = logs.length
					? logs
							.map(
								(log) =>
									`\`${log.created_at}\` **${log.action}** by ${
										log.actor_id ?? 'system'
									} ${log.detail ?? ''}`.trim(),
							)
							.join('\n')
					: 'The audit log is empty.';

				await context.interaction.reply({
					embeds: [infoEmbed('ADMIN LOG', lines.slice(0, 4000))],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'reload',
			description: 'Reload the quest catalogue and the configuration.',
			run: async (context: CommandContext) => {
				assertAdmin(context);
				const result =
					await context.services.questService.refresh(
						context.services.scopeFor(context.userId),
					);

				context.services.adminService.audit(
					context.userId,
					'reload',
					`${result.quests.length} quests from ${result.source}`,
				);

				await context.interaction.reply({
					embeds: [
						successEmbed(
							`Reloaded **${result.quests.length}** quests from the **${result.source}** source.`,
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'backup',
			description: 'Create a database backup.',
			run: async (context: CommandContext) => {
				assertAdmin(context);
				const path = context.services.adminService.backup();

				context.services.adminService.audit(
					context.userId,
					'backup',
					path,
				);

				await context.interaction.reply({
					embeds: [
						successEmbed(`Backup written to \`${path}\`.`),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'restore',
			description: 'Restore the database from a backup.',
			build: (sub) => {
				sub.addStringOption((option) =>
					option
						.setName('file')
						.setDescription('Backup file name')
						.setRequired(true)
						.setAutocomplete(true),
				);
			},
			run: async (context: CommandContext) => {
				assertAdmin(context);
				const file = context.interaction.options.getString('file', true);
				const source = context.services.adminService.restore(file);

				context.services.adminService.audit(
					context.userId,
					'restore',
					source,
				);

				await context.interaction.reply({
					embeds: [
						successEmbed(
							`Database restored from \`${source}\`.`,
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'maintenance',
			description: 'Toggle maintenance mode (only admins can use the bot).',
			run: async (context: CommandContext) => {
				assertAdmin(context);
				const enabled =
					context.services.adminService.isMaintenance();

				await context.interaction.reply({
					embeds: [
						infoEmbed(
							'MAINTENANCE',
							`Maintenance mode is currently **${
								enabled ? 'on' : 'off'
							}**. Use the button below to toggle it.`,
						),
					],
					components: [buildMaintenanceRow()],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'config',
			description: 'Show or change a configuration value.',
			build: adminOption,
			run: async (context: CommandContext) => {
				assertAdmin(context);
				const key = context.interaction.options.getString('key', true);
				const value = context.interaction.options.getString(
					'value',
					true,
				);

				context.services.adminService.setConfig(key, value);
				context.services.adminService.audit(
					context.userId,
					'config',
					`${key}=${value}`,
				);

				await context.interaction.reply({
					embeds: [successEmbed(`\`${key}\` is now \`${value}\`.`)],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'purge',
			description: 'Delete every piece of data of a user.',
			build: (sub) => {
				sub.addStringOption((option) =>
					option
						.setName('user')
						.setDescription('The Discord user id')
						.setRequired(true),
				);
			},
			run: async (context: CommandContext) => {
				assertAdmin(context);
				const userId = context.interaction.options
					.getString('user', true)
					.trim();

				if (!/^\d{15,25}$/.test(userId)) {
					await context.interaction.reply({
						content:
							'That does not look like a Discord id (it should be 17-20 digits).',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				context.services.repositories.purgeUser(userId);
				context.services.adminService.audit(
					context.userId,
					'purge_user',
					userId,
				);

				await context.interaction.reply({
					embeds: [
						successEmbed(
							`Every piece of data of \`${userId}\` was deleted - the link, the rooms, the progress, the history and the rewards.`,
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'whitelist',
			description:
				'Only allow specific servers or users to use the bot.',
			subcommands: [
				{
					name: 'list',
					description: 'Show the whitelisted servers and users.',
					run: async (context: CommandContext) => {
						assertAdmin(context);
						const entries = context.services.adminService.whitelist();
						const enabled =
							context.services.adminService.isWhitelistEnabled();

						const lines = entries.length
							? entries
									.map(
										(entry) =>
											`\`${entry.kind}\` **${
												entry.label ?? entry.entry_id
											}** - role: **${
												entry.role
											}**\n\`${entry.entry_id}\` - added by ${
												entry.added_by ?? 'unknown'
											} on ${entry.created_at}`,
									)
									.join('\n\n')
							: 'The whitelist is empty.';

						await context.interaction.reply({
							embeds: [
								infoEmbed(
									'WHITELIST',
									`The whitelist is **${
										enabled ? 'active' : 'inactive'
									}** - ${
										enabled
											? 'only the listed servers and users can use the bot.'
											: 'everybody can use the bot.'
									}\n\n${lines}`.slice(0, 4000),
								),
							],
							flags: MessageFlags.Ephemeral,
						});
					},
				},
				{
					name: 'add',
					description: 'Add a server or a user to the whitelist.',
					build: (sub) => {
						sub.addStringOption((option) =>
							option
								.setName('kind')
								.setDescription('What should be added')
								.setRequired(true)
								.addChoices(
									{ name: 'guild', value: 'guild' },
									{ name: 'user', value: 'user' },
								),
						);
						sub.addStringOption((option) =>
							option
								.setName('id')
								.setDescription('The guild id or the user id')
								.setRequired(true),
						);
					sub.addStringOption((option) =>
						option
							.setName('label')
							.setDescription('A name for this entry')
							.setRequired(false),
					);
					sub.addStringOption((option) =>
						option
							.setName('role')
							.setDescription('The access role for this entry')
							.setRequired(false)
							.addChoices(
								{ name: 'member', value: 'member' },
								{ name: 'admin', value: 'admin' },
							),
					);
				},
				run: async (context: CommandContext) => {
						assertAdmin(context);
						const kind = context.interaction.options.getString(
							'kind',
							true,
						) as 'guild' | 'user';
						const id = context.interaction.options.getString(
							'id',
							true,
						).trim();
					const label =
						context.interaction.options.getString('label') ??
						null;
					const role =
						(context.interaction.options.getString(
							'role',
						) as 'member' | 'admin' | null) ?? 'member';

					if (!/^\d{15,25}$/.test(id)) {
							await context.interaction.reply({
								content:
									'That does not look like a Discord id (it should be 17-20 digits).',
								flags: MessageFlags.Ephemeral,
							});
							return;
						}

					context.services.adminService.addWhitelist(
						kind,
						id,
						label,
						context.userId,
						role,
					);
						context.services.adminService.audit(
							context.userId,
							'whitelist_add',
							`${kind}:${id}`,
						);

						await context.interaction.reply({
							embeds: [
								successEmbed(
									`Added the ${kind} \`${id}\` to the whitelist.`,
								),
							],
							flags: MessageFlags.Ephemeral,
						});
					},
				},
				{
					name: 'role',
					description:
						'Change the role (member/admin) of a whitelisted entry.',
					build: (sub) => {
						sub.addStringOption((option) =>
							option
								.setName('kind')
								.setDescription('What the entry is')
								.setRequired(true)
								.addChoices(
									{ name: 'guild', value: 'guild' },
									{ name: 'user', value: 'user' },
								),
						);
						sub.addStringOption((option) =>
							option
								.setName('id')
								.setDescription('The guild id or the user id')
								.setRequired(true),
						);
						sub.addStringOption((option) =>
							option
								.setName('role')
								.setDescription('The new role for this entry')
								.setRequired(true)
								.addChoices(
									{ name: 'member', value: 'member' },
									{ name: 'admin', value: 'admin' },
								),
						);
					},
					run: async (context: CommandContext) => {
						assertAdmin(context);
						const kind = context.interaction.options.getString(
							'kind',
							true,
						) as 'guild' | 'user';
						const id = context.interaction.options.getString(
							'id',
							true,
						).trim();
						const role = context.interaction.options.getString(
							'role',
							true,
						) as 'member' | 'admin';

						const entries = context.services.adminService.whitelist(
							kind,
						);

						if (!entries.some((entry) => entry.entry_id === id)) {
							await context.interaction.reply({
								content: `\`${id}\` is not on the whitelist.`,
								flags: MessageFlags.Ephemeral,
							});
							return;
						}

						context.services.adminService.setWhitelistRole(
							kind,
							id,
							role,
						);
						context.services.adminService.audit(
							context.userId,
							'whitelist_role',
							`${kind}:${id}=${role}`,
						);

						await context.interaction.reply({
							embeds: [
								successEmbed(
									`The ${kind} \`${id}\` now has the **${role}** role.`,
								),
							],
							flags: MessageFlags.Ephemeral,
						});
					},
				},
				{
					name: 'remove',
					description: 'Remove a server or a user from the whitelist.',
					build: (sub) => {
						sub.addStringOption((option) =>
							option
								.setName('kind')
								.setDescription('What should be removed')
								.setRequired(true)
								.addChoices(
									{ name: 'guild', value: 'guild' },
									{ name: 'user', value: 'user' },
								),
						);
						sub.addStringOption((option) =>
							option
								.setName('id')
								.setDescription('The guild id or the user id')
								.setRequired(true),
						);
					},
					run: async (context: CommandContext) => {
						assertAdmin(context);
						const kind = context.interaction.options.getString(
							'kind',
							true,
						) as 'guild' | 'user';
						const id = context.interaction.options.getString(
							'id',
							true,
						).trim();

						const removed =
							context.services.adminService.removeWhitelist(
								kind,
								id,
							);

						context.services.adminService.audit(
							context.userId,
							'whitelist_remove',
							`${kind}:${id}`,
						);

						await context.interaction.reply({
							embeds: [
								removed
									? successEmbed(
											`Removed the ${kind} \`${id}\` from the whitelist.`,
										)
									: errorEmbed(
											`\`${id}\` was not on the whitelist.`,
										),
							],
							flags: MessageFlags.Ephemeral,
						});
					},
				},
				{
					name: 'enable',
					description: 'Turn the whitelist on.',
					run: async (context: CommandContext) => {
						assertAdmin(context);
						context.services.adminService.setWhitelistEnabled(
							true,
						);
						context.services.adminService.audit(
							context.userId,
							'whitelist_enable',
							null,
						);

						await context.interaction.reply({
							embeds: [
								successEmbed(
									'The whitelist is active. Only the listed servers and users (plus the owner and the admin role) can use the bot.',
								),
							],
							flags: MessageFlags.Ephemeral,
						});
					},
				},
				{
					name: 'disable',
					description: 'Turn the whitelist off.',
					run: async (context: CommandContext) => {
						assertAdmin(context);
						context.services.adminService.setWhitelistEnabled(
							false,
						);
						context.services.adminService.audit(
							context.userId,
							'whitelist_disable',
							null,
						);

						await context.interaction.reply({
							embeds: [
								successEmbed(
									'The whitelist is inactive - everybody can use the bot again.',
								),
							],
							flags: MessageFlags.Ephemeral,
						});
					},
				},
				{
					name: 'sync',
					description:
						'Add every server the bot is in to the whitelist.',
					run: async (context: CommandContext) => {
						assertAdmin(context);

						const guilds = (await context.services.client.rest.get(
							'/users/@me/guilds',
						)) as { id: string; name: string }[];

						for (const guild of guilds ?? []) {
							context.services.adminService.addWhitelist(
								'guild',
								guild.id,
								guild.name,
								context.userId,
							);
						}

						context.services.adminService.audit(
							context.userId,
							'whitelist_sync',
							`${guilds?.length ?? 0} guilds`,
						);

						await context.interaction.reply({
							embeds: [
								successEmbed(
									`Added **${guilds?.length ?? 0}** server(s) to the whitelist.`,
								),
							],
							flags: MessageFlags.Ephemeral,
						});
					},
				},
			],
		},
	],
);

export const ADMIN_PERMISSION = PermissionFlagsBits.ManageGuild;
