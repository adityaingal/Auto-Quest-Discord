import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { CommandContext, group } from './types';
import { successEmbed } from '../ui/embeds';
import { isAdmin } from './admin';
import { PermissionError } from '../utils/errors';
import { TokenService, TokenType } from '../services/tokenService';

function assertAdmin(context: CommandContext): void {
	if (!isAdmin(context)) {
		throw new PermissionError(
			'Only the bot owner or the configured admin role can register tokens.',
		);
	}
}

/**
 * The only token command exposed as a slash command. All other token and
 * admin commands live behind the owner-only prefix commands (!token / !admin).
 *
 * This command is hidden from regular users twice:
 *   1. `setDefaultMemberPermissions(Administrator)` - regular members never
 *      see it in the slash command picker,
 *   2. `assertAdmin` runs at execution time, so it cannot be invoked by
 *      someone who crafts the interaction by hand.
 */
const base = group(
	'token',
	'Owner only - register a token.',
	[
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
								`Stored encrypted and shown as \`${record.masked}\` (fingerprint \`${record.fingerprint}\`).`,
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
	],
);

base.data.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export const tokenCommand = base;
