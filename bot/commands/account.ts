import { ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { CommandContext, group } from './types';
import { infoEmbed, successEmbed } from '../ui/embeds';

export const accountCommand = group(
	'account',
	'Link a Discord account through the official OAuth2 flow.',
	[
		{
			name: 'link',
			description: 'Link your Discord account with OAuth2.',
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const url = await services.accountService.beginLink(userId);

				await interaction.reply({
					embeds: [
						infoEmbed(
							'LINK YOUR ACCOUNT',
							'Discord asks you to authorise this bot. Only the `identify` scope is requested - your password is never needed.',
						),
					],
					components: [
						{
							type: 1,
							components: [
								new ButtonBuilder()
									.setLabel('Authorise with Discord')
									.setStyle(ButtonStyle.Link)
									.setURL(url),
							],
						},
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'status',
			description: 'Show whether an account is linked and still valid.',
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const status = services.accountService.status(userId);

				const embed = status.linked
					? infoEmbed('LINKED ACCOUNT', 'This account is linked.', [
							{
								name: 'Discord account',
								value: `${
									status.discordUsername ?? 'unknown'
								} (\`${status.discordAccountId}\`)`,
							},
							{
								name: 'Authorization expires',
								value: status.expiresAt ?? 'unknown',
							},
							{
								name: 'State',
								value: status.expired
									? 'expired - run `/account link` again'
									: 'active',
							},
					  ])
					: infoEmbed(
							'NO ACCOUNT LINKED',
							'Run `/account link` to connect your Discord account.',
					  );

				await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
			},
		},
		{
			name: 'unlink',
			description: 'Remove the linked account and its credentials.',
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const removed = services.accountService.unlink(userId);

				await interaction.reply({
					embeds: [
						successEmbed(
							removed > 0
								? 'The linked account and its stored credentials were deleted.'
								: 'There was no linked account - nothing to remove.',
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'privacy',
			description: 'Explain what data is stored and how to remove it.',
			run: async (context: CommandContext) => {
				const { interaction, services } = context;

				await interaction.reply({
					embeds: [
						infoEmbed(
							'PRIVACY',
							services.accountService.privacyNotice().join('\n'),
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
	],
);
