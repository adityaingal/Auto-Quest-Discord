import { ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { CommandContext, group } from './types';
import { infoEmbed } from '../ui/embeds';
import { REWARD_TYPE_NAMES } from '../models/enums';

function questOption(sub: any): void {
	sub.addStringOption((option: any) =>
		option
			.setName('quest')
			.setDescription('Quest id or name')
			.setRequired(true)
			.setAutocomplete(true),
	);
}

export const rewardCommand = group(
	'reward',
	'Reward information, eligibility and the official claim flow.',
	[
		{
			name: 'list',
			description: 'List the rewards that are recorded for your account.',
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const rewards = services.rewardService.list(userId);

				const lines = rewards.length
					? rewards
							.map((reward) => {
								const type =
									reward.reward_type != null
										? (REWARD_TYPE_NAMES[
												reward.reward_type
											] ?? `Type ${reward.reward_type}`)
										: 'unknown type';

								return `**${reward.reward_name ?? reward.quest_id}**\n` +
									`\`${reward.quest_id}\` - ${type} - ${reward.status}`;
							})
							.join('\n\n')
					: 'No rewards recorded yet. Run `/quest refresh` after linking an account.';

				await interaction.reply({
					embeds: [infoEmbed('REWARDS', lines.slice(0, 4000))],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'info',
			description: 'Show the reward and its requirements for a quest.',
			build: questOption,
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const questId = interaction.options.getString('quest', true);
				const quest = await services.questService.get(questId, scope);
				const status = services.rewardService.buildStatus(quest);

				await interaction.reply({
					embeds: [
						infoEmbed(
							`REWARD: ${status.rewardName ?? 'unknown'}`,
							quest.name,
							[
								{
									name: 'Type',
									value: status.rewardTypeName ?? 'unknown',
								},
								{
									name: 'Orbs',
									value: status.orbQuantity
										? String(status.orbQuantity)
										: '-',
								},
								{
									name: 'Requirement',
									value: quest.tasks.length
										? quest.tasks
												.map(
													(task) =>
														`\`${task.type}\` - ${task.target}s`,
												)
												.join('\n')
										: 'unknown',
								},
								{
									name: 'Redemption',
									value:
										status.instructions
											?.slice(0, 800) ?? 'see the Discord client',
								},
							],
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'status',
			description: 'Show whether a reward can be claimed and if it was claimed.',
			build: questOption,
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const questId = interaction.options.getString('quest', true);
				const quest = await services.questService.get(questId, scope);
				const status = await services.rewardService.status(
					questId,
					scope.userId,
					quest,
				);

				await interaction.reply({
					embeds: [
						infoEmbed('REWARD STATUS', quest.name, [
							{
								name: 'Reward',
								value: status.rewardName ?? 'unknown',
							},
							{
								name: 'Eligible',
								value: status.eligible ? 'yes' : 'no',
							},
							{
								name: 'Claimed',
								value: status.claimed
									? `yes - ${status.claimedAt ?? 'unknown time'}`
									: 'no',
							},
						]),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'claim',
			description: 'Start the official claim flow (Discord may ask for a captcha).',
			build: questOption,
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const questId = interaction.options.getString('quest', true);
				const quest = await services.questService.get(questId, scope);
				const status = services.rewardService.buildStatus(quest);

				services.rewardService.requireClaimable(status);

				await interaction.reply({
					embeds: [
						infoEmbed(
							'CLAIM REWARD',
							`Reward: **${status.rewardName}**\n\n` +
								'Discord performs the claim in the desktop or mobile client. ' +
								'When Discord asks for a captcha it must be solved by a human - ' +
								'this bot never bypasses that verification.',
							[
								{
									name: 'Quest status',
									value: quest.eligibility,
								},
								{
									name: 'Already claimed',
									value: status.claimed ? 'yes' : 'no',
								},
							],
						),
					],
					components: [
						{
							type: 1,
							components: [
								new ButtonBuilder()
									.setLabel('Open Discord Quest Home')
									.setStyle(ButtonStyle.Link)
									.setURL(
										status.redemptionLink ??
											'https://discord.com/quest-home',
									),
							],
						},
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'code',
			description: 'Fetch a claimed reward code through the Discord API.',
			build: questOption,
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const questId = interaction.options.getString('quest', true);

				try {
					const result = await services.rewardService.code(
						questId,
						scope.userId,
					);

					await interaction.reply({
						embeds: [
							infoEmbed('REWARD CODE', 'Retrieved from Discord.', [
								{
									name: 'Code',
									value: `\`${result.code}\``,
								},
								{
									name: 'Platform',
									value: result.platform?.toString() ?? 'unknown',
								},
							]),
						],
						flags: MessageFlags.Ephemeral,
					});
				} catch (error) {
					await interaction.reply({
						content: `Could not retrieve a reward code: ${
							(error as Error).message
						}`,
						flags: MessageFlags.Ephemeral,
					});
				}
			},
		},
	],
);
