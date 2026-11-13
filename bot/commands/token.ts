import { MessageFlags } from 'discord.js';
import { CommandContext, group } from './types';
import { infoEmbed, successEmbed, errorEmbed } from '../ui/embeds';
import { isAdmin } from './admin';
import { PermissionError } from '../utils/errors';
import { TokenService, TokenType } from '../services/tokenService';
import { COLORS } from '../ui/theme';

function assertAdmin(context: CommandContext): void {
	if (!isAdmin(context)) {
		throw new PermissionError(
			'Only the bot owner or the configured admin role can manage bot tokens.',
		);
	}
}

export const tokenCommand = group(
	'token',
	'Manage additional bot tokens (encrypted at rest, never shown in full).',
	[
		{
			name: 'list',
			description: 'List every registered bot token.',
			build: (sub) => {
				sub.addStringOption((option) =>
					option
						.setName('type')
						.setDescription('Which tokens to show')
						.setRequired(false)
						.addChoices(
							{ name: 'all', value: 'all' },
							{ name: 'bot', value: 'bot' },
							{ name: 'user', value: 'user' },
						),
				);
			},
			run: async (context: CommandContext) => {
				assertAdmin(context);
				const filter =
					(context.interaction.options.getString('type') ??
						'all') as 'all' | TokenType;

				const tokens = context.services.tokenService
					.list()
					.filter(
						(token) => filter === 'all' || token.type === filter,
					);

				if (tokens.length === 0) {
					await context.interaction.reply({
						embeds: [
							infoEmbed(
								'BOT TOKENS',
								`No ${filter === 'all' ? '' : filter + ' '}token is registered. Add one with \`/token add\`.`,
							),
						],
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const lines = tokens
					.map(
						(token) =>
							`\`#${token.id}\` **${token.label}** - ${
								token.type === 'bot' ? 'bot' : 'user'
							} - ${
								token.botUsername ?? token.accountUsername ?? 'unknown'
							} (${token.botUserId ?? token.accountId ?? '?'})\n` +
							`status: ${token.status} - fingerprint \`${token.fingerprint}\` - last checked ${
								token.lastCheckedAt ?? 'never'
							}`,
					)
					.join('\n\n');

				await context.interaction.reply({
					embeds: [infoEmbed('BOT TOKENS', lines.slice(0, 4000))],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'add',
			description: 'Register a bot token or a user token.',
			build: (sub) => {
				sub.addStringOption((option) =>
					option
						.setName('label')
						.setDescription('A name for this token, e.g. "main"')
						.setRequired(true),
				);
				sub.addStringOption((option) =>
					option
						.setName('token')
						.setDescription('Bot token or user token')
						.setRequired(true),
				);
				sub.addStringOption((option) =>
					option
						.setName('type')
						.setDescription(
							'bot = an extra bot account, user = an account used for the quests',
						)
						.setRequired(true)
						.addChoices(
							{ name: 'bot', value: 'bot' },
							{ name: 'user', value: 'user' },
						),
				);
			},
			run: async (context: CommandContext) => {
				assertAdmin(context);
				const label = context.interaction.options.getString(
					'label',
					true,
				);
				const token = context.interaction.options.getString(
					'token',
					true,
				);
				const type = context.interaction.options.getString(
					'type',
					true,
				) as TokenType;

				const record = await context.services.tokenService.add(
					label,
					token,
					type,
				);

				await context.interaction.reply({
					embeds: [
						successEmbed(
							`Registered the **${record.type}** token \`${record.label}\` for ${record.botUsername ?? record.accountUsername ?? 'unknown'}.\n` +
								`Stored encrypted and shown as \`${record.masked}\` (fingerprint \`${record.fingerprint}\`).\n` +
								(type === 'bot'
									? 'Restart the bot to start it as an additional instance.'
									: 'Restart the bot to use this account for the quests.'),
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'remove',
			description: 'Remove a registered bot token.',
			build: (sub) => {
				sub.addIntegerOption((option) =>
					option
						.setName('id')
						.setDescription('The token id from /token list')
						.setRequired(true),
				);
			},
			run: async (context: CommandContext) => {
				assertAdmin(context);
				const id = context.interaction.options.getInteger('id', true);
				const removed = context.services.tokenService.remove(id);

				await context.interaction.reply({
					embeds: [
						removed
							? successEmbed(`Removed token #${id}.`)
							: errorEmbed(`There is no token with the id ${id}.`),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'import',
			description:
				'Register the USER_TOKEN environment variable as an account.',
			build: (sub) => {
				sub.addStringOption((option) =>
					option
						.setName('label')
						.setDescription('A name for this account')
						.setRequired(false),
				);
			},
			run: async (context: CommandContext) => {
				assertAdmin(context);

				const fromEnv = process.env.USER_TOKEN?.trim();
				if (!fromEnv) {
					await context.interaction.reply({
						content:
							'The USER_TOKEN environment variable is not set. Add it to the environment (and to the .env file locally) and restart the bot.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const label =
					context.interaction.options.getString('label')?.trim() ||
					'USER_TOKEN';

				const record = await context.services.tokenService.add(
					label,
					fromEnv,
					'user',
				);

				await context.interaction.reply({
					embeds: [
						successEmbed(
							`Imported the USER_TOKEN as **${record.label}** (${
								record.accountUsername ?? 'unknown account'
							}).\n` +
								`Stored encrypted as \`${record.masked}\` (fingerprint \`${record.fingerprint}\`).\n` +
								'The account is usable immediately - no restart needed.',
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'check',
			description: 'Validate a registered bot token against Discord.',
			build: (sub) => {
				sub.addIntegerOption((option) =>
					option
						.setName('id')
						.setDescription('The token id from /token list')
						.setRequired(true),
				);
			},
			run: async (context: CommandContext) => {
				assertAdmin(context);
				const id = context.interaction.options.getInteger('id', true);
				const check = await context.services.tokenService.revalidate(id);

				await context.interaction.reply({
					embeds: [
						{
							color: check.valid ? COLORS.success : COLORS.danger,
							title: check.valid
								? 'TOKEN VALID'
								: 'TOKEN INVALID',
							description: check.message,
						},
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
	],
);

export const TOKEN_HELP = TokenService.mask;
