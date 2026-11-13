import { MessageFlags } from 'discord.js';
import { CommandContext, group } from './types';
import { infoEmbed } from '../ui/embeds';
import {
	QuestTaskType,
	READABLE_TASK_TYPES,
} from '../models/enums';
import { QuestEligibility } from '../models/enums';
import { renderProgressBar } from '../ui/theme';
import { ProgressService } from '../services/progressService';

const TASK_NOTES: Record<string, string> = {
	[QuestTaskType.WATCH_VIDEO]:
		'Watch the quest video in the Discord client for the required duration.',
	[QuestTaskType.WATCH_VIDEO_ON_MOBILE]:
		'Watch the quest video on the Discord mobile app.',
	[QuestTaskType.PLAY_ON_DESKTOP]:
		'Play the game on desktop while the Discord desktop app is running.',
	[QuestTaskType.STREAM_ON_DESKTOP]:
		'Stream the game on desktop with at least one other person in the voice channel.',
	[QuestTaskType.PLAY_ACTIVITY]:
		'Play the embedded activity for the required duration.',
	[QuestTaskType.PLAY_ON_XBOX]:
		'Console only - play the game on an Xbox console.',
	[QuestTaskType.PLAY_ON_PLAYSTATION]:
		'Console only - play the game on a PlayStation console.',
	[QuestTaskType.ACHIEVEMENT_IN_GAME]:
		'The game reports the achievement to Discord.',
	[QuestTaskType.ACHIEVEMENT_IN_ACTIVITY]:
		'The embedded activity reports the achievement to Discord.',
};

export const taskCommand = group(
	'task',
	'Task types, their requirements and the recorded progress.',
	[
		{
			name: 'list',
			description: 'List every task type Discord uses for quests.',
			run: async (context: CommandContext) => {
				const { interaction } = context;

				const lines = READABLE_TASK_TYPES.map(
					(type) => `**\`${type}\`** - ${TASK_NOTES[type]}`,
				).join('\n');

				await interaction.reply({
					embeds: [
						infoEmbed(
							'TASK TYPES',
							lines,
							[
								{
									name: 'Reading progress',
									value:
										'Progress is read from Discord API responses. The bot never fabricates progress values.',
								},
							],
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'info',
			description: 'Explain one task type in detail.',
			build: (sub) => {
				sub.addStringOption((option) =>
					option
						.setName('task')
						.setDescription('Task type')
						.setRequired(true)
						.addChoices(
							...READABLE_TASK_TYPES.map((type) => ({
								name: type,
								value: type,
							})),
						),
				);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const task = interaction.options.getString('task', true);
				const { quests } = await services.questService.list(userId);

				const matching = quests.filter((quest) =>
					quest.taskTypes.includes(task),
				);

				const requirement = matching
					.flatMap((quest) => quest.tasks)
					.filter((entry) => entry.type === task)
					.map((entry) => `${entry.target}s`)
					.join(', ');

				await interaction.reply({
					embeds: [
						infoEmbed(
							`TASK: ${task}`,
							TASK_NOTES[task] ?? 'Unknown task type.',
							[
								{
									name: 'Typical requirement',
									value: requirement
										? `${requirement} of play/watch time`
										: 'varies per quest',
								},
								{
									name: 'Quests using it',
									value: matching.length
										? matching
												.slice(0, 10)
												.map((quest) => `\`${quest.name}\``)
												.join(', ')
										: 'none in the current catalogue',
								},
							],
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'progress',
			description: 'Show the recorded progress grouped by task type.',
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const entries = services.progressService.list(userId);

				const lines = entries.map((entry) => {
					const percent = ProgressService.percent(
						entry.value,
						entry.target,
					);

					return `\`${entry.quest_id}\`\n${renderProgressBar(
						percent,
					)} - ${entry.status}`;
				});

				await interaction.reply({
					embeds: [
						infoEmbed(
							'TASK PROGRESS',
							lines.length
								? lines.join('\n\n').slice(0, 4000)
								: 'No progress recorded yet. Run `/quest refresh` after linking an account.',
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'verify',
			description: 'Verify a quest progress value against the Discord API response.',
			build: (sub) => {
				sub.addStringOption((option) =>
					option
						.setName('quest')
						.setDescription('Quest id or name')
						.setRequired(true)
						.setAutocomplete(true),
				);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const questId = interaction.options.getString('quest', true);

				try {
					const quest = await services.questService.status(
						questId,
						userId,
					);

					if (!quest.live) {
						await interaction.reply({
							embeds: [
								infoEmbed(
									'VERIFICATION UNAVAILABLE',
									'Discord only serves live quest state to the signed-in user session. The bot cannot verify a value that was not returned by a live API response, so it will not guess one.',
									[
										{
											name: 'Last recorded value',
											value: quest.progress
												? `${quest.progress.value}s / ${quest.progress.target}s`
												: 'nothing recorded',
										},
									],
								),
							],
							flags: MessageFlags.Ephemeral,
						});
						return;
					}

					await interaction.reply({
						embeds: [
							infoEmbed('VERIFIED', 'Live API response received.', [
								{
									name: 'Quest',
									value: quest.name,
								},
								{
									name: 'Progress',
									value: quest.progress
										? `${quest.progress.value}s / ${quest.progress.target}s (${quest.progress.percent}%)`
										: 'no progress reported',
								},
								{
									name: 'Status',
									value: quest.eligibility,
								},
							]),
						],
						flags: MessageFlags.Ephemeral,
					});
				} catch (error) {
					await interaction.reply({
						content: `Verification failed: ${
							(error as Error).message
						}`,
						flags: MessageFlags.Ephemeral,
					});
				}
			},
		},
	],
);
