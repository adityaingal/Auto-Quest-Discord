import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	StringSelectMenuBuilder,
} from 'discord.js';
import { QuestView } from '../models/quest';

export const PAGE_SIZE = 25;

export function buildQuestPages(quests: QuestView[]): QuestView[][] {
	const pages: QuestView[][] = [];

	for (let index = 0; index < quests.length; index += PAGE_SIZE) {
		pages.push(quests.slice(index, index + PAGE_SIZE));
	}

	return pages.length > 0 ? pages : [[]];
}

/**
 * Dropdown that lets a user pick a quest from the current page.
 */
export function buildQuestSelect(
	quests: QuestView[],
	page: number,
): ActionRowBuilder<StringSelectMenuBuilder> {
	const menu = new StringSelectMenuBuilder()
		.setCustomId(`quest:select:${page}`)
		.setPlaceholder('Select a quest for details')
		.setMinValues(1)
		.setMaxValues(1);

	for (const quest of quests.slice(0, PAGE_SIZE)) {
		menu.addOptions({
			label: quest.name.slice(0, 100),
			description: `${quest.applicationName ?? 'unknown app'} - ${
				quest.id
			}`.slice(0, 100),
			value: quest.id,
		});
	}

	return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildPagingRow(
	page: number,
	pages: number,
): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`quest:page:${page - 1}`)
			.setLabel('Previous')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page <= 0),
		new ButtonBuilder()
			.setCustomId(`quest:pageinfo`)
			.setLabel(`Page ${page + 1}/${pages}`)
			.setStyle(ButtonStyle.Primary)
			.setDisabled(true),
		new ButtonBuilder()
			.setCustomId(`quest:page:${page + 1}`)
			.setLabel('Next')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page >= pages - 1),
	);
}

export function buildQuestActions(
	questId: string,
): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`quest:info:${questId}`)
			.setLabel('Quest Information')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId(`quest:refresh:${questId}`)
			.setLabel('Refresh Progress')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId(`quest:requirements:${questId}`)
			.setLabel('View Requirements')
			.setStyle(ButtonStyle.Secondary),
	);
}

export function buildStartConfirmRow(
	questId: string,
): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`quest:start_confirm:${questId}`)
			.setLabel('Start in Discord')
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId(`quest:start_cancel:${questId}`)
			.setLabel('Cancel')
			.setStyle(ButtonStyle.Secondary),
	);
}

export function buildMaintenanceRow(): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('admin:maintenance_confirm')
			.setLabel('Toggle maintenance mode')
			.setStyle(ButtonStyle.Danger),
		new ButtonBuilder()
			.setCustomId('admin:maintenance_cancel')
			.setLabel('Cancel')
			.setStyle(ButtonStyle.Secondary),
	);
}

export function selectComponentType(): ComponentType {
	return ComponentType.StringSelect;
}
