import { MessageFlags, SlashCommandSubcommandBuilder } from 'discord.js';
import { CommandContext, group } from './types';
import {
	buildQuestActions,
	buildQuestPages,
	buildQuestSelect,
	buildPagingRow,
	buildStartConfirmRow,
} from '../ui/components';
import { questDetailEmbed, questListEmbed, questQueueEmbed } from '../ui/embeds';
import type { QueueEntry } from '../ui/embeds';
import { infoEmbed } from '../ui/embeds';
import { ELIGIBILITY_LABELS } from '../models/enums';

function questOption(sub: SlashCommandSubcommandBuilder): void {
	sub.addStringOption((option) =>
		option
			.setName('quest')
			.setDescription('Quest id or name')
			.setRequired(true)
			.setAutocomplete(true),
	);
}

export const questCommand = group(
	'quest',
	'Inspect Discord quests, their requirements and rewards.',
	[
		{
			name: 'list',
			description: 'List the quests that are currently available.',
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const result = await services.questService.list(userId);
				const pages = buildQuestPages(result.quests);
				const page = 0;

				await interaction.reply({
					embeds: [
						questListEmbed(result.quests, result.source, result.live),
					],
					components: [
						buildQuestSelect(pages[page], page),
						buildPagingRow(page, pages.length),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'info',
			description: 'Show every detail of one quest.',
			build: questOption,
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const questId = interaction.options.getString('quest', true);
				const quest = await services.questService.get(questId, userId);

				await interaction.reply({
					embeds: [questDetailEmbed(quest)],
					components: [buildQuestActions(quest.id)],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'start',
			description: 'Start a quest (enrolment happens in the Discord client).',
			build: questOption,
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const questId = interaction.options.getString('quest', true);
				const quest = await services.questService.get(questId, userId);

				await interaction.reply({
					embeds: [questDetailEmbed(quest)],
					components: [buildStartConfirmRow(quest.id)],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'progress',
			description: 'Show the progress recorded for your account.',
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const entries = services.progressService.list(userId);

				const { progressEmbed } = await import('../ui/embeds');

				await interaction.reply({
					embeds: [
						progressEmbed(
							entries.map((entry) => ({
								questId: entry.quest_id,
								questName: entry.quest_id,
								status:
									ELIGIBILITY_LABELS[
										entry.status as keyof typeof ELIGIBILITY_LABELS
									] ?? entry.status,
								value: entry.value,
								target: entry.target,
								percent: entry.percent,
								updatedAt: entry.updated_at,
							})),
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'status',
			description: 'Show the status of one quest for your account.',
			build: questOption,
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const questId = interaction.options.getString('quest', true);
				const quest = await services.questService.status(
					questId,
					userId,
				);

				await interaction.reply({
					embeds: [questDetailEmbed(quest)],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'sessions',
			description:
				'Show the user sessions (accounts) the bot works with - no token is revealed.',
			run: async (context: CommandContext) => {
				const { interaction, services } = context;

				if (!services.autoService.enabled) {
					await interaction.reply({
						content:
							'No user session is configured. Add one with `/token add <label> <token> user`.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const sessions = await services.autoService.describeSessions();

				const lines = sessions.map((session) => {
					const state = session.ok
						? '🟢 active'
						: `🔴 ${session.error ?? 'not usable'}`;

					return `**${session.label}** - ${
						session.username ?? 'unknown account'
					} (\`${session.accountId ?? '?'}\`)\n${state} - ${
						session.quests
					} quests available`;
				});

				await interaction.reply({
					embeds: [
						infoEmbed(
							'USER SESSIONS',
							lines.length
								? lines.join('\n\n')
								: 'No user session is configured.',
							[
								{
									name: 'Privacy',
									value:
										'The tokens are encrypted on disk and are never displayed.',
								},
							],
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'all',
			description:
				'Complete every available quest automatically with a live timer.',
			build: (sub) => {
				sub.addBooleanOption((option) =>
					option
						.setName('stop')
						.setDescription('Stop the running queue instead'),
				);
			},
			run: async (context: CommandContext) => {
				const { interaction, services } = context;

				if (!services.autoService.enabled) {
					await interaction.reply({
						content:
							'The automation is disabled. Add an account with `/token add <label> <token> user` or set USER_TOKEN in the environment.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				if (interaction.options.getBoolean('stop')) {
					services.autoService.requestStop();
					await interaction.reply({
						content:
							'🛑 The queue will stop after the current quest.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const live = await services.autoService.listLiveQuests();
				if (!live) {
					await interaction.reply({
						content:
							'Could not read the quests of the configured account.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const entries: QueueEntry[] = live.quests.map((quest) => ({
					name: quest.config.messages.quest_name,
					taskType: null,
					value: 0,
					target: 0,
					state: 'queued',
				}));

				const response = await interaction.reply({
					embeds: [
						questQueueEmbed(entries, live.account, 0, entries.length),
					],
					flags: MessageFlags.Ephemeral,
				});

				let done = 0;
				let lastEdit = 0;

				// A message can only be edited for 15 minutes. When that
				// window is over a new message is posted and updated from
				// then on, so the queue stays visible for the whole run.
				let current: {
					edit(options: unknown): Promise<unknown>;
				} = response;
				let validUntil = Date.now() + 13 * 60_000;

				const publish = async () => {
					const embed = questQueueEmbed(
						entries,
						live.account,
						done,
						entries.length,
					);

					if (Date.now() > validUntil) {
						current = await interaction.followUp({
							embeds: [embed],
							flags: MessageFlags.Ephemeral,
						});
						validUntil = Date.now() + 13 * 60_000;
						return;
					}

					try {
						await current.edit({ embeds: [embed] });
					} catch {
						// the token expired - post a fresh message
						try {
							current = await interaction.followUp({
								embeds: [embed],
								flags: MessageFlags.Ephemeral,
							});
							validUntil = Date.now() + 13 * 60_000;
						} catch {
							// give up on the live view
						}
					}
				};

				const summary = await services.autoService.runAll(
					async (quest, progress, index, total) => {
						const entry = entries[index];
						if (!entry) return;

						entry.name = quest.config.messages.quest_name;
						entry.taskType = progress.taskType;
						entry.value = progress.value;
						entry.target = progress.target;
						entry.state = progress.state;

						if (progress.state === 'done') {
							done++;

							// Announce it right away - in the channel and
							// as a direct message.
							await services.notifier.send(
								`✅ **Quest completed**: \`${quest.config.messages.quest_name}\`\nClaim the reward in the Discord client.`,
							);
							await publish();
							return;
						}

						// Discord rate limits message edits - 5 seconds is safe.
						const now = Date.now();
						if (now - lastEdit < 5000) return;
						lastEdit = now;

						await publish();
					},
				);

				entries.forEach((entry) => {
					if (entry.state === 'queued') entry.state = 'skipped';
				});

				await publish();

				await interaction.followUp({
					content:
						`🏁 **${summary.completed}** quest(s) completed, ` +
						`**${summary.failed}** failed, **${summary.skipped}** skipped.\n` +
						'Claim the rewards in the Discord client.',
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'auto',
			description:
				'Complete a quest automatically (needs a configured user session).',
			build: questOption,
			run: async (context: CommandContext) => {
				const { interaction, services } = context;

				if (!services.autoService.enabled) {
					await interaction.reply({
						content:
							'The automation is disabled. Add an account with `/token add <label> <token> user` or set USER_TOKEN in the environment.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const live = await services.autoService.listLiveQuests();
				const questId = interaction.options.getString('quest', true);
				const quest =
					live?.quests.find((entry) => entry.id === questId) ??
					live?.quests.find((entry) =>
						entry.config.messages.quest_name
							.toLowerCase()
							.includes(questId.toLowerCase()),
					);

				if (!quest || !live) {
					await interaction.reply({
						content:
							'That quest is not available for the configured account.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				await interaction.reply({
					content:
						`Working on **${quest.config.messages.quest_name}** (account \`${live.account}\`) - this can take a while. The bot will report back when it is done.`,
					flags: MessageFlags.Ephemeral,
				});

				const result = await services.autoService.run(
					quest,
					live.account,
				);

				await interaction.followUp({
					content: result.finished
						? `✅ ${result.message}`
						: `⚠️ ${result.message}`,
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'refresh',
			description: 'Refresh the quest information the bot knows about.',
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const result = await services.questService.refresh(userId);

				for (const quest of result.quests.slice(0, 50)) {
					services.questService.recordProgress(userId, quest);
				}

				await interaction.reply({
					content:
						`Refreshed **${result.quests.length}** quests from the **${result.source}** source.`,
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'history',
			description: 'Show your recent quest activity.',
			run: async (context: CommandContext) => {
				const { interaction, services, userId } = context;
				const history = services.questService.history(userId, 15);

				const lines = history.length
					? history
							.map(
								(entry) =>
									`\`${entry.created_at}\` **${entry.event_type}** ${
										entry.quest_id ?? ''
									} ${entry.detail ?? ''}`.trim(),
							)
							.join('\n')
					: 'No activity recorded yet.';

				await interaction.reply({
					embeds: [
						{
							color: 0x5865f2,
							title: 'HISTORY',
							description: lines.slice(0, 4000),
						},
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
	],
);
