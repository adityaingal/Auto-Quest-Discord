import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Interaction,
	InteractionType,
	MessageFlags,
	StringSelectMenuBuilder,
} from 'discord.js';
import { Services } from '../services';
import { AccountScope } from '../services/scope';
import { Logger } from '../utils/logger';
import { toUserMessage } from '../utils/errors';
import { buildQuestPages, buildQuestSelect, buildPagingRow } from '../ui/components';
import { errorEmbed, infoEmbed, questDetailEmbed, questListEmbed, questQueueEmbed, progressEmbed } from '../ui/embeds';
import { isAdmin } from './admin';
import {
	renderQuestPanel,
	decodeSegment,
	decodeFilter,
	filterPayloadQuests,
} from '../ui/panel';
import type { QueueEntry } from '../ui/embeds';
import type { QueueJob, AutoProgress } from '../services/autoService';
import type { QuestPayload } from '../integrations/userSession';

type Handler = (
	interaction: Interaction,
	services: Services,
) => Promise<void>;

/**
 * Routes the message component interactions (buttons and dropdowns) that the
 * command embeds create.
 */
export class InteractionRouter {
	private readonly handlers = new Map<string, Handler>();

	constructor(private readonly services: Services) {
		this.register('quest:select', this.handleQuestSelect);
		this.register('quest:page', this.handleQuestPage);
		this.register('quest:info', this.handleQuestInfo);
		this.register('quest:refresh', this.handleQuestRefresh);
		this.register('quest:requirements', this.handleQuestRequirements);
		this.register('quest:start_confirm', this.handleStartConfirm);
		this.register('quest:start_cancel', this.handleStartCancel);
		this.register('quest:panel_select', this.handlePanelSelect);
		this.register('quest:panel_prev', this.handlePanelNav);
		this.register('quest:panel_next', this.handlePanelNav);
		this.register('quest:panel_refresh', this.handlePanelRefresh);
		this.register('quest:panel_details', this.handlePanelDetails);
		this.register('quest:panel_progress', this.handlePanelProgress);
		this.register('quest:panel_help', this.handlePanelHelp);
		this.register('quest:access', this.handleQuestAccess);
		this.register('quest:panel_complete_all', this.handleCompleteAll);
		this.register('quest:panel_filter', this.handlePanelFilter);
		this.register('admin:maintenance_confirm', this.handleMaintenance);
		this.register('admin:maintenance_cancel', this.handleMaintenanceCancel);
	}

	private register(prefix: string, handler: Handler): void {
		this.handlers.set(prefix, handler);
	}

	async handle(interaction: Interaction): Promise<void> {
		if (
			interaction.type !== InteractionType.MessageComponent
		) {
			return;
		}

		const customId = interaction.customId;
		const prefix = customId.split(':').slice(0, 2).join(':');

		const handler = this.handlers.get(prefix);
		if (!handler) {
			await this.safeReply(interaction, 'Unknown action.');
			return;
		}

		try {
			await handler(interaction, this.services);
		} catch (error) {
			Logger.error(
				`Component interaction failed: ${(error as Error).message}`,
			);
			await this.safeReply(interaction, toUserMessage(error));
		}
	}

	private async safeReply(
		interaction: Interaction,
		message: string,
	): Promise<void> {
		const flags = InteractionType.MessageComponent ===
			interaction.type
			? MessageFlags.Ephemeral
			: undefined;

		if (interaction.isRepliable()) {
			await interaction.reply({
				content: message,
				flags,
			});
		}
	}

	private userId(interaction: Interaction): string {
		return interaction.user.id;
	}

	/**
	 * The scope of the user that clicked the button. It is derived from the
	 * user id, so a component interaction can never reach more than the
	 * matching command would.
	 */
	private scope(
		interaction: Interaction,
		services: Services,
	): AccountScope {
		return services.scopeFor(interaction.user.id);
	}

	private async handleQuestSelect(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		const value = (
			interaction.message.components as unknown as {
				components?: { options?: { value?: string }[] }[];
			}[]
		)
			.flatMap((row) => row.components ?? [])
			.find((component) => component.options)
			?.options?.[0]?.value;

		if (!value) return;

		const quest = await services.questService.get(
			value,
			this.scope(interaction, services),
		);

		await interaction.update({
			embeds: [questDetailEmbed(quest)],
			components: [
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(`quest:info:${quest.id}`)
						.setLabel('Quest Information')
						.setStyle(ButtonStyle.Primary),
					new ButtonBuilder()
						.setCustomId(`quest:refresh:${quest.id}`)
						.setLabel('Refresh Progress')
						.setStyle(ButtonStyle.Secondary),
					new ButtonBuilder()
						.setCustomId(`quest:requirements:${quest.id}`)
						.setLabel('View Requirements')
						.setStyle(ButtonStyle.Secondary),
				),
			],
		});
	}

	private async handleQuestPage(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		const page = Number(interaction.customId.split(':')[2] ?? 0);
		const { quests, source, live } = await services.questService.list(
			this.scope(interaction, services),
		);
		const pages = buildQuestPages(quests);
		const safePage = Math.min(Math.max(page, 0), pages.length - 1);

		await interaction.update({
			embeds: [questListEmbed(quests, source, live)],
			components: [
				buildQuestSelect(pages[safePage], safePage),
				buildPagingRow(safePage, pages.length),
			],
		});
	}

	private async handleQuestInfo(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		const questId = interaction.customId.split(':')[2];
		const quest = await services.questService.get(
			questId,
			this.scope(interaction, services),
		);

		await interaction.update({ embeds: [questDetailEmbed(quest)] });
	}

	private async handleQuestRefresh(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		const questId = interaction.customId.split(':')[2];
		const quest = await services.questService.status(
			questId,
			this.scope(interaction, services),
		);

		services.questService.recordProgress(
			this.userId(interaction),
			quest,
		);

		await interaction.update({
			embeds: [questDetailEmbed(quest)],
			components: [],
		});
	}

	private async handleQuestRequirements(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		const questId = interaction.customId.split(':')[2];
		const quest = await services.questService.get(
			questId,
			this.scope(interaction, services),
		);

		const lines = quest.tasks.length
			? quest.tasks
					.map(
						(task) =>
							`\`${task.type}\` - ${task.target} seconds required`,
					)
					.join('\n')
			: 'No task configuration was published for this quest.';

		await interaction.update({
			embeds: [
				{
					color: 0x5865f2,
					title: `REQUIREMENTS: ${quest.name}`,
					description: lines,
					footer: { text: `Quest ID ${quest.id}` },
				},
			],
			components: [],
		});
	}

	private async handleStartConfirm(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		const questId = interaction.customId.split(':')[2];
		const result = await services.questService.start(
			questId,
			this.scope(interaction, services),
		);

		await interaction.update({
			embeds: [
				{
					color: result.started ? 0x57f287 : 0xfee75c,
					title: `START: ${result.quest.name}`,
					description: result.message,
				},
			],
			components: [],
		});
	}

	private async handleStartCancel(
		interaction: Interaction,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		await interaction.update({
			content: 'Cancelled - nothing was started.',
			components: [],
		});
	}

	private async handleMaintenance(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		if (!isAdmin({
			services,
			userId: interaction.user.id,
			member: interaction.member,
		})) {
			await interaction.reply({
				content: 'Only admins can change the maintenance mode.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const enabled = !services.adminService.isMaintenance();
		services.adminService.setMaintenance(enabled);
		services.adminService.audit(
			interaction.user.id,
			'maintenance',
			enabled ? 'on' : 'off',
		);

		await interaction.update({
			content: `Maintenance mode is now **${
				enabled ? 'on' : 'off'
			}**.`,
			components: [],
		});
	}

	private async handleMaintenanceCancel(
		interaction: Interaction,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		await interaction.update({
			content: 'Nothing was changed.',
			components: [],
		});
	}

	private async handlePanelFilter(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		const parts = interaction.customId.split(':');
		// quest:panel_filter:<filter>:<account>
		const rawFilter = parts[2];
		const filter =
			rawFilter === 'videos' || rawFilter === 'games' ? rawFilter : 'all';
		const account = decodeSegment(parts[3]);

		const scope = services.scopeFor(interaction.user.id);
		const payload = await renderQuestPanel(
			services,
			scope,
			null,
			account,
			0,
			filter,
		);

		await interaction.update({ ...payload });
	}

	private async handlePanelSelect(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		const scope = services.scopeFor(interaction.user.id);
		const account = decodeSegment(interaction.customId.split(':')[3]);
		const questId = interaction.isStringSelectMenu()
			? interaction.values[0]
			: undefined;

		if (!questId) return;

		const page = Number(interaction.customId.split(':')[2] ?? 0);
		const payload = await renderQuestPanel(
			services,
			scope,
			questId,
			account,
			page,
		);

		await interaction.update({ ...payload });
	}

	private async handlePanelNav(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		const scope = services.scopeFor(interaction.user.id);
		const parts = interaction.customId.split(':');
		const page = Number(parts[2] ?? 0);
		const account = decodeSegment(parts[3]);
		const questId = parts[4] ?? null;

		const target =
			interaction.customId.startsWith('quest:panel_next:')
				? page + 1
				: Math.max(0, page - 1);

		const payload = await renderQuestPanel(
			services,
			scope,
			questId,
			account,
			target,
		);

		await interaction.update({ ...payload });
	}

	private async handlePanelRefresh(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		const parts = interaction.customId.split(':');
		const questId = parts[2];
		const account = decodeSegment(parts[3]);

		const scope = services.scopeFor(interaction.user.id);
		const payload = await renderQuestPanel(
			services,
			scope,
			questId,
			account,
			0,
		);

		await interaction.update({ ...payload });
	}

	private async handlePanelDetails(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		const parts = interaction.customId.split(':');
		const questId = parts[2];
		const account = decodeSegment(parts[3]);

		const scope = services.scopeFor(interaction.user.id);
		const quest = await services.questService.get(
			questId,
			scope,
			account,
		);

		await interaction.reply({
			embeds: [questDetailEmbed(quest)],
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handlePanelProgress(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		const parts = interaction.customId.split(':');
		const questId = parts[2];
		const account = decodeSegment(parts[3]);

		const scope = services.scopeFor(interaction.user.id);
		const quest = await services.questService.status(
			questId,
			scope,
			account,
		);

		const percent = quest.progress?.percent ?? 0;
		const lines = [
			`**${quest.name}**`,
			'',
			`Progress: ${quest.progress ? `${percent}% (${quest.progress.value}s / ${quest.progress.target}s)` : 'not enrolled'}`,
			`Enrolled at: ${quest.progress?.enrolledAt ?? 'not enrolled'}`,
			`Completed at: ${quest.progress?.completedAt ?? 'not completed'}`,
		].join('\n');

		await interaction.reply({
			embeds: [
				progressEmbed(
					[
						{
							questId: quest.id,
							questName: quest.name,
							status: quest.eligibility,
							value: quest.progress?.value ?? 0,
							target: quest.progress?.target ?? 0,
							percent,
							updatedAt: quest.expiresAt ?? new Date().toISOString(),
						},
					],
				),
			],
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handlePanelHelp(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		const parts = interaction.customId.split(':');
		const account = decodeSegment(parts[3]);
		const scope = services.scopeFor(interaction.user.id);

		const status = services.accountService.status(scope.userId);

		const embed = infoEmbed('QUEST HELP', 'Why a quest may be unavailable.', [
			{
				name: 'How a quest works',
				value:
					'Quests are sponsored missions. Complete the required task in the Discord client and the reward is granted to the linked account.',
			},
			{
				name: 'Common reasons a quest is unavailable',
				value: [
					'- The quest expired',
					'- The quest is only offered on a platform you do not have',
					'- The quest is only for certain regions',
					'- You already completed it',
				].join('\n'),
			},
			{
				name: 'Account access',
				value: status.linked
					? `Linked as ${status.discordUsername ?? 'unknown'} - quest access is available.`
					: 'No account is linked. Run `/quest access` to link one with the official OAuth2 flow.',
			},
			{
				name: 'Enrollment',
				value:
					'Enrolling happens in the Discord client: open Quest Home, pick the quest and press Start.',
			},
		]);

		await interaction.reply({
			embeds: [embed],
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handleQuestAccess(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		if (interaction.customId === 'quest:access:disconnect') {
			await interaction.update({
				content:
					'Disconnect your account? This deletes the linked account and its stored credentials.',
				components: [
					new ActionRowBuilder<ButtonBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId('quest:access:confirm')
							.setLabel('Delete the link')
							.setStyle(ButtonStyle.Danger),
						new ButtonBuilder()
							.setCustomId('quest:access:cancel')
							.setLabel('Keep it')
							.setStyle(ButtonStyle.Secondary),
					),
				],
			});
			return;
		}

		if (interaction.customId === 'quest:access:confirm') {
			const removed = services.accountService.unlink(
				interaction.user.id,
			);

			await interaction.update({
				content:
					removed > 0
						? 'The linked account and its stored credentials were deleted.'
						: 'There was no linked account - nothing to remove.',
				components: [],
			});
			return;
		}

		await interaction.update({
			content: 'Nothing was changed.',
			components: [],
		});
	}

	/**
	 * The Complete All button. It shows which quests are queued for the
	 * user's scope, runs them (with a live, throttled progress embed) and
	 * finishes with a summary. The reply is ephemeral - nobody else sees it.
	 */
	private async handleCompleteAll(
		interaction: Interaction,
		services: Services,
	): Promise<void> {
		if (!interaction.isMessageComponent()) return;

		const account = decodeSegment(interaction.customId.split(':')[2]);
		const filter = decodeFilter(interaction.customId.split(':')[3]);
		const scope = services.scopeFor(interaction.user.id);

		if (!services.autoService.enabled(scope)) {
			await interaction.reply({
				content:
					'You have no account yet. Add one with `!token add <label> <token> user` (owner prefix command).',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (services.autoService.isRunning(scope)) {
			await interaction.reply({
				content:
					'A quest queue is already running - use `!quest stop` to stop it.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const plan = await services.autoService.planQueue(scope, { account });
		const accounts = [...new Set(plan.map((job) => job.account))];

		if (plan.length === 0) {
			await interaction.reply({
				embeds: [
					infoEmbed(
						'NOTHING TO DO',
						'There are no quests available for your accounts right now. The catalogue changes over time - try again later.',
					),
				],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const filteredPlan = plan.filter((job) =>
			filterPayloadQuests([job.quest], filter).length > 0,
		);

		// The live view.
		const entries: QueueEntry[] = filteredPlan.map((job) => ({
				name: job.quest.config.messages.quest_name,
				account: job.account,
				taskType: job.quest.config.task_config_v2?.tasks
					? Object.keys(job.quest.config.task_config_v2.tasks)[0] ?? null
					: null,
				value: 0,
				target: 0,
				state: 'queued',
				quest: job.quest,
			}));

		if (entries.length === 0) {
			await interaction.reply({
				embeds: [
					infoEmbed(
						'NOTHING TO DO',
						'No video/game quests are available for your accounts right now. Try `/quest panel category:all`.',
					),
				],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const publish = async () => {
			const done = entries.filter(
				(entry) => entry.state === 'done',
			).length;

			// Discord refuses more than 5 buttons on a message, so the
			// live view has no buttons - it is just the embed.
			const embed = questQueueEmbed(
				entries.slice(0, 15),
				accounts,
				done,
				entries.length,
			);

			return embed;
		};

		await interaction.reply({
			embeds: [await publish()],
			flags: MessageFlags.Ephemeral,
		});

		let summary: Awaited<
			ReturnType<typeof services.autoService.runAll>
		> | null = null;
		let lastEdit = 0;

		const live = async (
			_quest: QuestPayload,
			progress: {
				value: number;
				target: number;
				taskType: string | null;
				state: QueueEntry['state'];
			},
			index: number,
		) => {
			const entry = entries[index];
			if (!entry) return;

			entry.taskType = progress.taskType;
			entry.value = progress.value;
			entry.target = progress.target;
			entry.state = progress.state as QueueEntry['state'];

			// Throttle edits - Discord only allows a few per second.
			const now = Date.now();
			if (now - lastEdit < 1500) return;
			lastEdit = now;

			try {
				await interaction.editReply({
					embeds: [await publish()],
				});
			} catch {
				// The interaction expired - the follow-up reports the result.
			}
		};

		try {
			summary = await services.autoService.runAll(
				scope,
				async (quest, progress, index) => {
					const state: QueueEntry['state'] =
						progress.state === 'queued'
							? 'queued'
							: progress.state === 'running'
								? 'running'
								: progress.state === 'done'
									? 'done'
									: progress.state === 'failed'
										? 'failed'
										: 'skipped';

					await live(quest, { ...progress, state }, index);
				},
				{ account, plan: filteredPlan },
			);
		} catch (error) {
			Logger.error(
				`The complete-all queue failed: ${(error as Error).message}`,
			);
		}

		// The final state of every quest.
		for (const result of summary?.results ?? []) {
			const entry = entries.find((candidate) =>
				candidate.name.toLowerCase().includes(
					result.quest.toLowerCase(),
				),
			);

			if (entry) {
				entry.state = result.finished ? 'done' : 'failed';
			}
		}

		const done = entries.filter((entry) => entry.state === 'done').length;
		const final = questQueueEmbed(
			entries.slice(0, 15),
			accounts,
			done,
			entries.length,
		);

		try {
			await interaction.editReply({ embeds: [final] });
		} catch {
			// The interaction expired - report via a new message.
		}

		await interaction.followUp({
			content: [
				'**Quest queue done**',
				`Completed: ${summary?.completed ?? 0}`,
				`Failed: ${summary?.failed ?? 0}`,
				`Skipped: ${summary?.skipped ?? 0}`,
			].join('\n'),
			flags: MessageFlags.Ephemeral,
		});
	}
}
