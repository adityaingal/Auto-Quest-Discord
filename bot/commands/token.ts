import { MessageFlags } from 'discord.js';
import { CommandContext, group } from './types';
import { successEmbed } from '../ui/embeds';
import { isAdmin } from './admin';
import { PermissionError } from '../utils/errors';
import { TokenType } from '../services/tokenService';

const base = group(
	'token',
	'Register your own token for quest automation.',
	[
		{
			name: 'add',
			description: 'Register your own user token, or a bot token as an admin.',
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
						.setDescription('Your Discord user token')
						.setRequired(true),
				);
				sub.addStringOption((option) =>
					option
						.setName('type')
						.setDescription(
							'user = your account for quests, bot = an extra bot account (admin only)',
						)
						.setRequired(true)
						.addChoices(
							{ name: 'user', value: 'user' },
							{ name: 'bot', value: 'bot' },
						),
				);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const privileged = isAdmin({
					services,
					userId,
					member: interaction.member,
				});
				const label = interaction.options.getString('label', true);
				const token = interaction.options.getString('token', true);
				const selectedType = interaction.options.getString(
					'type',
					true,
				) as TokenType;

				if (!privileged && selectedType === 'bot') {
					throw new PermissionError(
						'Only the bot owner or an admin can register bot tokens. Use type **user** to register your own token.',
					);
				}

				const type = privileged ? selectedType : 'user';
				const ownerUserId = privileged ? null : userId;
				const record = await services.tokenService.add(
					label,
					token,
					type,
					ownerUserId,
				);

				await interaction.reply({
					embeds: [
						successEmbed(
							`Registered the **${record.type}** token \`${record.label}\` for ${record.botUsername ?? record.accountUsername ?? 'unknown'}.\n` +
								`Stored encrypted and shown as \`${record.masked}\` (fingerprint \`${record.fingerprint}\`).\n` +
								(ownerUserId
									? 'Only you can use this token.'
									: 'Owner/operator token.'),
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
	],
);

export const tokenCommand = base;
