import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChatInputCommandInteraction,
	MessageFlags,
	Interaction,
	InteractionType,
	StringSelectMenuBuilder,
} from 'discord.js';
import { Services } from '../services';
import { Logger } from '../utils/logger';
import { toUserMessage } from '../utils/errors';
import { buildQuestPages, buildQuestSelect, buildPagingRow } from '../ui/components';
import { errorEmbed, questDetailEmbed, questListEmbed } from '../ui/embeds';
import { isAdmin } from './admin';

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
			this.userId(interaction),
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
			this.userId(interaction),
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
			this.userId(interaction),
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
			this.userId(interaction),
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
			this.userId(interaction),
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
			this.userId(interaction),
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

		if (!isAdmin(contextOf(interaction, services))) {
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
}

/**
 * Builds the minimal context the admin check needs from a component
 * interaction.
 */
function contextOf(
	interaction: Interaction,
	services: Services,
): {
	interaction: ChatInputCommandInteraction;
	services: Services;
	userId: string;
	guildId: string | null;
} {
	return {
		interaction: interaction as unknown as ChatInputCommandInteraction,
		services,
		userId: interaction.user.id,
		guildId: interaction.guildId,
	};
}
