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
import { infoEmbed, successEmbed } from '../ui/embeds';
import { ELIGIBILITY_LABELS } from '../models/enums';
import { toUserMessage } from '../utils/errors';

function questOption(sub: SlashCommandSubcommandBuilder): void {
	sub.addStringOption((option) =>
		option
			.setName('quest')
			.setDescription('Quest id or name')
			.setRequired(true)
			.setAutocomplete(true),
	);
}

/**
 * The account the command works with. Without it the account that was
 * selected with "/quest switch" is used - and if none is selected, every
 * account works at the same time.
 */
function accountOption(sub: SlashCommandSubcommandBuilder): void {
	sub.addStringOption((option) =>
		option
			.setName('account')
			.setDescription('The account to use - every account when omitted')
			.setRequired(false)
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
			build: accountOption,
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const account = services.autoService.resolveAccount(
					scope,
					interaction.options.getString('account'),
				);
				const result = await services.questService.list(
					scope,
					account,
				);
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
			build: (sub) => {
				questOption(sub);
				accountOption(sub);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const questId = interaction.options.getString('quest', true);
				const account = services.autoService.resolveAccount(
					scope,
					interaction.options.getString('account'),
				);
				const quest = await services.questService.get(
					questId,
					scope,
					account,
				);

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
				const { interaction, services, scope } = context;
				const questId = interaction.options.getString('quest', true);
				const quest = await services.questService.get(questId, scope);

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
			build: (sub) => {
				questOption(sub);
				accountOption(sub);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const questId = interaction.options.getString('quest', true);
				const account = services.autoService.resolveAccount(
					scope,
					interaction.options.getString('account'),
				);
				const quest = await services.questService.status(
					questId,
					scope,
					account,
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
				'Show the accounts (sessions) of your rooms - no token is revealed.',
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;

				if (!services.autoService.enabled(scope)) {
					await interaction.reply({
						content:
							'You have no account yet. Add one with `/room add`, or use `/token add` if you are an admin.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const sessions = await services.autoService.describeSessions(
					scope,
				);
				const selected = services.autoService.defaultAccount(scope);

				const lines = sessions.map((session) => {
					const state = session.ok
						? '🟢 active'
						: `🔴 ${session.error ?? 'not usable'}`;
					const marker = session.label === selected ? ' ⭐' : '';

					return `**${session.label}**${marker} - ${
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
									name: 'Selected account',
									value: selected
										? `**${selected}** - only this account is used.`
										: 'none - every account is used and all quests start at the same time.',
								},
								{
									name: 'Switching',
									value:
										'`/quest switch account:<label>` selects one account, `/quest switch account:all` uses every account again.',
								},
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
			name: 'switch',
			description:
				'Choose the account of your rooms the bot works with ("all" uses every account).',
			build: (sub) => {
				sub.addStringOption((option) =>
					option
						.setName('account')
						.setDescription('The account label or "all"')
						.setRequired(true)
						.setAutocomplete(true),
				);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;

				const value = (
					interaction.options.getString('account', true) ?? ''
				).trim();

				if (value.toLowerCase() === 'all') {
					services.autoService.setDefaultAccount(scope, null);
					await interaction.reply({
						embeds: [
							successEmbed(
								'Every account is used again - the quests of all accounts start at the same time.',
							),
						],
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				services.autoService.setDefaultAccount(scope, value);
				await interaction.reply({
					embeds: [
						successEmbed(
							`The bot now works with the account **${value}**. Every other account stays available through \`/quest all account:<label>\`.`,
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'all',
			description:
				'Complete every available quest automatically - all accounts start at the same time.',
			build: (sub) => {
				sub.addBooleanOption((option) =>
					option
						.setName('stop')
						.setDescription('Stop the running queue instead'),
				);
				accountOption(sub);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;

				if (!services.autoService.enabled(scope)) {
					await interaction.reply({
						content:
							'You have no account yet. Add one with `/room add`, or use `/token add` if you are an admin.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				if (interaction.options.getBoolean('stop')) {
					services.autoService.requestStop(scope);
					await interaction.reply({
						content:
							'🛑 The queue will stop after the current quest.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				if (services.autoService.isRunning(scope)) {
					await interaction.reply({
						content:
							'A quest queue is already running - stop it with `/quest all stop` first.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const account = services.autoService.resolveAccount(
					scope,
					interaction.options.getString('account'),
				);

				// The plan is fetched once, so the queue view and the
				// progress that is reported later always match.
				const plan = await services.autoService.planQueue(scope, {
					account,
				});
				const accounts = [...new Set(plan.map((job) => job.account))];

				const entries: QueueEntry[] = plan.map((job) => ({
					name: job.quest.config.messages.quest_name,
					account: job.account,
					taskType: null,
					value: 0,
					target: 0,
					state: 'queued',
				}));

				const response = await interaction.reply({
					embeds: [
						questQueueEmbed(entries, accounts, 0, entries.length),
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
						accounts,
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

				let summary: Awaited<
					ReturnType<typeof services.autoService.runAll>
				>;

				try {
					summary = await services.autoService.runAll(
						scope,
						async (quest, progress, index) => {
							const entry = entries[index];
							if (!entry) return;

							entry.name = quest.config.messages.quest_name;
							entry.taskType = progress.taskType;
							entry.value = progress.value;
							entry.target = progress.target;
							entry.state = progress.state;

							if (progress.state === 'done') {
								done++;

								// Announce it right away - in the channel
								// and as a direct message.
								await services.notifier.send(
									`✅ **Quest completed**: \`${quest.config.messages.quest_name}\`\nClaim the reward in the Discord client.`,
								);
								await publish();
								return;
							}

							// Discord rate limits message edits - 5 seconds
							// is safe.
							const now = Date.now();
							if (now - lastEdit < 5000) return;
							lastEdit = now;

							await publish();
						},
						{ account, plan },
					);
				} catch (error) {
					await interaction.followUp({
						content: toUserMessage(error),
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				entries.forEach((entry) => {
					if (entry.state === 'queued') entry.state = 'skipped';
				});

				await publish();

				await interaction.followUp({
					content:
						`🏁 **${summary.completed}** quest(s) completed, ` +
						`**${summary.failed}** failed, **${summary.skipped}** skipped.\n` +
						`Accounts: ${accounts.join(', ') || 'none'}.\n` +
						'Claim the rewards in the Discord client.',
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'auto',
			description:
				'Complete a quest automatically (needs a configured user session).',
			build: (sub) => {
				questOption(sub);
				accountOption(sub);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;

				if (!services.autoService.enabled(scope)) {
					await interaction.reply({
						content:
							'You have no account yet. Add one with `/room add`, or use `/token add` if you are an admin.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				if (services.autoService.isRunning(scope)) {
					await interaction.reply({
						content:
							'A quest queue is already running - stop it with `/quest all stop` first.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const account = services.autoService.resolveAccount(
					scope,
					interaction.options.getString('account'),
				);
				const questId = interaction.options.getString('quest', true);

				// Every account that offers the quest works on it - they all
				// start at the same time.
				const plan = await services.autoService.planQueue(scope, {
					account,
					quest: questId,
				});

				if (plan.length === 0) {
					await interaction.reply({
						content:
							'That quest is not available for the selected account.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const accounts = [...new Set(plan.map((job) => job.account))];
				const name = plan[0].quest.config.messages.quest_name;

				await interaction.reply({
					content:
						`Working on **${name}** (accounts: ${accounts.join(
							', ',
						)}) - this can take a while. The bot will report back when it is done.`,
					flags: MessageFlags.Ephemeral,
				});

				let summary: Awaited<
					ReturnType<typeof services.autoService.runAll>
				>;

				try {
					summary = await services.autoService.runAll(
						scope,
						undefined,
						{
							account,
							quest: questId,
							plan,
						},
					);
				} catch (error) {
					await interaction.followUp({
						content: toUserMessage(error),
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const lines = summary.results.map(
					(result) =>
						`${result.finished ? '✅' : '⚠️'} **${result.account}** - ${result.quest}: ${result.message}`,
				);

				await interaction.followUp({
					content: lines.join('\n').slice(0, 1900),
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'refresh',
			description: 'Refresh the quest information the bot knows about.',
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const result = await services.questService.refresh(scope);

				for (const quest of result.quests.slice(0, 50)) {
					services.questService.recordProgress(scope.userId, quest);
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
