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
	completeAll: 'quest:panel_complete_all',
	filter: 'quest:panel_filter',
} as const;

export type PanelPayload = {
	embeds: ReturnType<typeof questPanelEmbed>[];
	components: ActionRowBuilder<
		StringSelectMenuBuilder | ButtonBuilder
	>[];
};

/** The task-type categories the user can filter the quests by. */
export type QuestFilter = 'all' | 'videos' | 'games';

const FILTER_LABELS: Record<QuestFilter, string> = {
	all: 'All',
	videos: 'Videos',
	games: 'Games',
};

const VIDEO_TASKS = new Set([
	'WATCH_VIDEO',
	'WATCH_VIDEO_ON_MOBILE',
]);

const GAME_TASKS = new Set([
	'PLAY_ON_DESKTOP',
	'PLAY_ON_XBOX',
	'PLAY_ON_PLAYSTATION',
	'PLAY_ACTIVITY',
	'STREAM_ON_DESKTOP',
	'ACHIEVEMENT_IN_GAME',
	'ACHIEVEMENT_IN_ACTIVITY',
]);

/** Filters the quests by task category. */
export function filterQuests<T extends { taskTypes: string[] }>(
	quests: T[],
	filter: QuestFilter,
): T[] {
	if (filter === 'all') return quests;

	const wanted = filter === 'videos' ? VIDEO_TASKS : GAME_TASKS;

	return quests.filter((quest) =>
		quest.taskTypes.some((type) => wanted.has(type)),
	);
}

/** Filters the live quests (payload shape) by the same category. */
export function filterPayloadQuests<
	T extends {
		config?: {
			task_config?: { tasks?: Record<string, { target: number }> };
			task_config_v2?: { tasks?: Record<string, { target: number }> };
		};
	},
>(payloads: T[], filter: QuestFilter): T[] {
	if (filter === 'all') return payloads;

	const wanted = filter === 'videos' ? VIDEO_TASKS : GAME_TASKS;

	return payloads.filter((payload) => {
		const tasks =
			Object.keys(payload.config?.task_config_v2?.tasks ?? {}).length
				? payload.config?.task_config_v2?.tasks ?? {}
				: payload.config?.task_config?.tasks ?? {};

		const types = Object.keys(tasks);

		return types.some((type) => wanted.has(type));
	});
}

/** The filter buttons row labelled with the filter that is in effect. */
export function filterButtons(
	current: QuestFilter,
	account: string,
): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`${PANEL_IDS.filter}:all:${account}`)
			.setLabel('All')
			.setStyle(
				current === 'all' ? ButtonStyle.Primary : ButtonStyle.Secondary,
			),
		new ButtonBuilder()
			.setCustomId(`${PANEL_IDS.filter}:videos:${account}`)
			.setLabel('Videos')
			.setStyle(
				current === 'videos' ? ButtonStyle.Primary : ButtonStyle.Secondary,
			),
		new ButtonBuilder()
			.setCustomId(`${PANEL_IDS.filter}:games:${account}`)
			.setLabel('Games')
			.setStyle(
				current === 'games' ? ButtonStyle.Primary : ButtonStyle.Secondary,
			),
	);
}

export function describeFilter(filter: QuestFilter): string {
	return FILTER_LABELS[filter] ?? FILTER_LABELS.all;
}


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

/** Decodes the filter the user picked in one of the tab buttons. */
export function decodeFilter(
	segment: string | undefined,
): QuestFilter {
	if (segment === 'videos' || segment === 'games') return segment;
	return 'all';
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
 * The dropdown panel with every quest the scope can see. The page and the
 * filter are both carried in the custom id, so a page turn or a filter click
 * re-renders against the live list with the same selection.
 */
export function questSelectMenu(
	quests: QuestView[],
	selectedId: string,
	page: number,
	account = '-',
	filter: QuestFilter = 'all',
): ActionRowBuilder<StringSelectMenuBuilder> {
	const filtered = filterQuests(quests, filter);
	const totalPages = Math.max(1, Math.ceil(filtered.length / PANEL_PAGE));
	const safePage = Math.min(Math.max(page, 0), totalPages - 1);
	const slice = filtered.slice(
		safePage * PANEL_PAGE,
		safePage * PANEL_PAGE + PANEL_PAGE,
	);

	const menu = new StringSelectMenuBuilder()
		.setCustomId(`${PANEL_IDS.select}:${safePage}:${account}:${filter}`)
		.setPlaceholder(
			filtered.length > PANEL_PAGE
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
	filter: QuestFilter = 'all',
): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`${PANEL_IDS.prev}:${page}:${account}:${filter}:${selectedId}`)
			.setLabel('Previous page')
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page <= 0),
		new ButtonBuilder()
			.setCustomId(`${PANEL_IDS.next}:${page}:${account}:${filter}:${selectedId}`)
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
 * The button that runs every quest the account of the user offers. Only the
 * owner can operate the automation, and it is only available when the user
 * has an account configured. The filter decides which quests are run.
 */
export function completeAllButton(
	account = '-',
	filter: QuestFilter = 'all',
): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`${PANEL_IDS.completeAll}:${account}:${filter}`)
			.setLabel('Complete All Quests')
			.setStyle(ButtonStyle.Success)
			.setEmoji('⚡'),
	);
}

/**
 * Assembles the complete panel: the embed, the filter buttons, the select
 * menu and the action buttons.
 */
export function buildQuestPanel(
	quest: QuestDetail,
	quests: QuestView[],
	page: number,
	accountLabel: string | null,
	filter: QuestFilter = 'all',
): PanelPayload {
	const filtered = filterQuests(quests, filter);
	const totalPages = Math.max(1, Math.ceil(filtered.length / PANEL_PAGE));
	const safePage = Math.min(Math.max(page, 0), totalPages - 1);
	const account = accountSegment(accountLabel);

	return {
		embeds: [questPanelEmbed(quest, accountLabel, filter)],
		components: [
			actionButtons(quest, account),
			filterButtons(filter, account),
			completeAllButton(account, filter),
			questSelectMenu(filtered, quest.id, safePage, account, filter),
			...(totalPages > 1
				? [navButtons(safePage, totalPages, quest.id, account, filter)]
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
	filter: QuestFilter = 'all',
): Promise<PanelPayload> {
	const list = await services.questService.list(scope, account);
	const filtered = filterQuests(list.quests, filter);

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

	const wanted =
		questId ??
		filtered[0]?.id ??
		list.quests[0]?.id ??
		null;

	if (!wanted) {
		return {
			embeds: [
				infoEmbed(
					`NO ${filter === 'all' ? 'QUESTS' : filter.toUpperCase()}`,
					`There is no ${filter === 'all' ? '' : `${filter.slice(0, -1)} `}quest right now. Try another filter.`,
				),
			],
			components: [filterButtons(filter, accountSegment(account))],
		};
	}

	const detail = await services.questService.get(wanted, scope, account);

	return buildQuestPanel(
		detail,
		list.quests,
		page,
		account ?? 'your accounts',
		filter,
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
