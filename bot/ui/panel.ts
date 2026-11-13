import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	StringSelectMenuBuilder,
} from 'discord.js';

import type { Services } from '../services';
import { QuestEligibility } from '../models/enums';
import type { AccountScope } from '../services/scope';
import type { QuestView, QuestDetail } from '../models/quest';
import { infoEmbed, questPanelEmbed } from './embeds';
import { formatDuration } from './theme';

export const PANEL_PAGE = 25;

/** The custom ids the panel components use. */
export const PANEL_IDS = {
	select: 'quest:panel_select',
	prev: 'quest:panel_prev',
	next: 'quest:panel_next',
	refresh: 'quest:panel_refresh',
	details: 'quest:panel_details',
	progress: 'quest:panel_progress',
	help: 'quest:panel_help',
} as const;

export type PanelPayload = {
	embeds: ReturnType<typeof questPanelEmbed>[];
	components: ActionRowBuilder<
		StringSelectMenuBuilder | ButtonBuilder
	>[];
};

const STATUS_TEXT: Record<QuestEligibility, string> = {
	[QuestEligibility.AVAILABLE]: 'available',
	[QuestEligibility.ENROLLED]: 'enrolled',
	[QuestEligibility.IN_PROGRESS]: 'in progress',
	[QuestEligibility.UNAVAILABLE]: 'unavailable',
	[QuestEligibility.COMPLETED]: 'completed',
};

/** Encodes the account label so it is safe inside a custom id. */
export function accountSegment(account: string | null): string {
	return account ? Buffer.from(account, 'utf8').toString('base64url') : '-';
}

/** Decodes the segment handed back by the component interaction. */
export function decodeSegment(segment: string | undefined): string | null {
	if (!segment || segment === '-') return null;

	try {
		return Buffer.from(segment, 'base64url').toString('utf8');
	} catch {
		return null;
	}
}

function describeQuest(quest: QuestView): string {
	const reward = quest.rewards[0];
	const head = reward
		? reward.orbQuantity
			? `${reward.orbQuantity} Orbs`
			: reward.name
		: 'no reward';

	return `${head} - ${STATUS_TEXT[quest.eligibility]}`.slice(0, 100);
}

/**
 * The dropdown panel with every quest the scope can see. The page is carried
 * in the custom id, so a page turn re-renders against the live list.
 */
export function questSelectMenu(
	quests: QuestView[],
	selectedId: string,
	page: number,
	account = '-',
): ActionRowBuilder<StringSelectMenuBuilder> {
	const totalPages = Math.max(1, Math.ceil(quests.length / PANEL_PAGE));
	const safePage = Math.min(Math.max(page, 0), totalPages - 1);
	const slice = quests.slice(
		safePage * PANEL_PAGE,
		safePage * PANEL_PAGE + PANEL_PAGE,
	);

	const menu = new StringSelectMenuBuilder()
		.setCustomId(`${PANEL_IDS.select}:${safePage}:${account}`)
		.setPlaceholder(
			quests.length > PANEL_PAGE
				? `Select a quest (${safePage + 1}/${totalPages})`
				: 'Select a quest',
		)
		.setMinValues(1)
		.setMaxValues(1)
		.setOptions(
			slice.map((quest) => ({
				label: quest.name.slice(0, 100),
				description: describeQuest(quest),
				value: quest.id,
				default: quest.id === selectedId,
			})),
		);

	return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
		menu,
	);
}

/** The previous/next buttons, only rendered when there is more than a page. */
function navButtons(
	page: number,
	totalPages: number,
	selectedId: string,
	account: string,
): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`${PANEL_IDS.prev}:${page}:${account}:${selectedId}`)
			.setLabel('Previous page')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page <= 0),
		new ButtonBuilder()
			.setCustomId(`${PANEL_IDS.next}:${page}:${account}:${selectedId}`)
			.setLabel('Next page')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page >= totalPages - 1),
	);
}

/**
 * The action buttons under the embed: the official quest URL (when the
 * catalogue published one), details, progress, refresh and help.
 */
export function actionButtons(
	quest: QuestDetail,
	account = '-',
): ActionRowBuilder<ButtonBuilder> {
	const components: ButtonBuilder[] = [];

	if (quest.ctaLink) {
		components.push(
			new ButtonBuilder()
				.setLabel('View Quest')
				.setStyle(ButtonStyle.Link)
				.setURL(quest.ctaLink),
		);
	}

	components.push(
		new ButtonBuilder()
			.setCustomId(`${PANEL_IDS.details}:${quest.id}:${account}`)
			.setLabel('Details')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId(`${PANEL_IDS.progress}:${quest.id}:${account}`)
			.setLabel('Progress')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId(`${PANEL_IDS.refresh}:${quest.id}:${account}`)
			.setLabel('Refresh')
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId(`${PANEL_IDS.help}:${quest.id}:${account}`)
			.setLabel('Help')
			.setStyle(ButtonStyle.Danger),
	);

	return new ActionRowBuilder<ButtonBuilder>().addComponents(components);
}

/**
 * Assembles the complete panel: the embed, the select menu and the buttons.
 */
export function buildQuestPanel(
	quest: QuestDetail,
	quests: QuestView[],
	page: number,
	accountLabel: string | null,
): PanelPayload {
	const totalPages = Math.max(1, Math.ceil(quests.length / PANEL_PAGE));
	const safePage = Math.min(Math.max(page, 0), totalPages - 1);
	const account = accountSegment(accountLabel);

	return {
		embeds: [questPanelEmbed(quest, accountLabel)],
		components: [
			actionButtons(quest, account),
			questSelectMenu(quests, quest.id, safePage, account),
			...(totalPages > 1
				? [navButtons(safePage, totalPages, quest.id, account)]
				: []),
		],
	};
}

/**
 * The full flow: fetch the quests of the scope and render the panel for the
 * requested quest (or the first one).
 */
export async function renderQuestPanel(
	services: Services,
	scope: AccountScope,
	questId: string | null,
	account: string | null,
	page = 0,
): Promise<PanelPayload> {
	const list = await services.questService.list(scope, account);

	if (list.quests.length === 0) {
		return {
			embeds: [
				infoEmbed(
					'QUESTS UNAVAILABLE',
					'No quests are available right now. Link an account with `/account link`, or wait for the next batch of quests.',
				),
			],
			components: [],
		};
	}

	const wanted = questId ?? list.quests[0].id;
	const detail = await services.questService.get(wanted, scope, account);

	return buildQuestPanel(
		detail,
		list.quests,
		page,
		account ?? 'your accounts',
	);
}

/** A short summary of a quest's reward - used by the select menu. */
export function describeRewards(quest: QuestView): string {
	const reward = quest.rewards[0];

	if (!reward) return 'no reward';

	const type = reward.orbQuantity
		? `${reward.orbQuantity} Orbs`
		: reward.name;
	const parts = [type];

	const total = quest.tasks.reduce((sum, task) => sum + task.target, 0);
	if (total > 0) {
		parts.push(formatDuration(total));
	}

	return parts.join(' · ').slice(0, 100);
}
