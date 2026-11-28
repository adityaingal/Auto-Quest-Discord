import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	StringSelectMenuBuilder,
} from 'discord.js';
import { QuestDetail, QuestView } from '../models/quest';
import {
	type AnnouncementMediaOptions,
	verifiedInviteUrl,
	verifiedQuestUrl,
} from './embeds';

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

/**
 * The buttons under a public new-quest announcement: the official quest
 * link (only when the catalogue published a verified https URL), the public
 * quest browser and a refresh of the announcement itself.
 */
export function buildAnnouncementRow(
	quest: QuestDetail,
	options: AnnouncementMediaOptions = {},
): ActionRowBuilder<ButtonBuilder> {
	const components: ButtonBuilder[] = [];
	const url = verifiedQuestUrl(quest);

	if (url) {
		components.push(
			new ButtonBuilder()
				.setLabel('View Quest')
				.setStyle(ButtonStyle.Link)
				.setURL(url),
		);
	}

	if (options.videosEnabled !== false && quest.videoUrl) {
		components.push(
			new ButtonBuilder()
				.setLabel('Watch Promo')
				.setStyle(ButtonStyle.Link)
				.setURL(quest.videoUrl),
		);
	}

	components.push(
		new ButtonBuilder()
			.setCustomId('quest:ann_quests')
			.setLabel('Available Quests')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId(`quest:ann_refresh:${quest.id}`)
			.setLabel('Refresh')
			.setStyle(ButtonStyle.Secondary),
	);

	return new ActionRowBuilder<ButtonBuilder>().addComponents(components);
}

/** Membership denial with an official invite button when one was configured. */
export function buildMembershipRow(
	inviteUrl: string | null,
): ActionRowBuilder<ButtonBuilder> | null {
	const invite = verifiedInviteUrl(inviteUrl);
	if (!invite) return null;

	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setLabel('Join Server')
			.setStyle(ButtonStyle.Link)
			.setURL(invite),
	);
}

/**
 * "Check All Quest Progress" - refreshes the caller's own progress. The
 * scope is resolved from the user that clicks it, never from the message.
 * Returned as a bare button so callers can share a row with another
 * button (Discord allows at most five component rows per message).
 */
export function checkAllButton(): ButtonBuilder {
	return new ButtonBuilder()
		.setCustomId('quest:check_all')
		.setLabel('Check All Quest Progress')
		.setStyle(ButtonStyle.Primary)
		.setEmoji('🔍');
}

export function selectComponentType(): ComponentType {
	return ComponentType.StringSelect;
}
