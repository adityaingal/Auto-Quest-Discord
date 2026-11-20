import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	StringSelectMenuBuilder,
	TextInputBuilder,
	TextInputStyle,
	type User,
} from 'discord.js';

import type { Services } from '../services';
import { QuestEligibility } from '../models/enums';
import type { AccountScope } from '../services/scope';
import type { QuestView, QuestDetail } from '../models/quest';
import {
	infoEmbed,
	ownerPanelEmbed,
	ownerProfileEmbed,
	questPanelEmbed,
} from './embeds';
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

/** The components of the owner-only user profile panel. */
export const OWNER_PANEL_IDS = {
	input: 'owner:profile_input',
	refresh: 'owner:profile_refresh',
	submit: 'owner:profile_submit',
	userId: 'owner_profile_user_id',
} as const;

/** The components of the unified owner command panel. */
export const OWNER_COMMAND_IDS = {
	home: 'owner:panel_home',
	select: 'owner:panel_select',
	prev: 'owner:panel_prev',
	next: 'owner:panel_next',
	back: 'owner:panel_back',
	again: 'owner:panel_again',
	modal: 'owner:panel_modal',
} as const;

export type OwnerField = {
	name: string;
	label: string;
	placeholder?: string;
	required?: boolean;
	paragraph?: boolean;
	maxLength?: number;
};

export type OwnerCommand = {
	id: string;
	label: string;
	description: string;
	fields: OwnerField[];
};

const f = (
	name: string,
	label: string,
	placeholder?: string,
	extra: Partial<OwnerField> = {},
): OwnerField => ({ name, label, placeholder, ...extra });

/** Every owner prefix command, in the order shown in the panel. */
export const OWNER_COMMANDS: OwnerCommand[] = [
	{
		id: 'profile',
		label: 'Profile',
		description: 'Show a Discord avatar and username',
		fields: [f('userId', 'User ID', '123456789012345678', { maxLength: 20 })],
	},
	{
		id: 'room.create',
		label: 'Room · Create',
		description: 'Create a room',
		fields: [
			f('name', 'Room name', 'Main', { required: true }),
			f('description', 'Description (optional)', 'Notes'),
		],
	},
	{
		id: 'room.search',
		label: 'Room · Search',
		description: 'Find a room by name',
		fields: [f('query', 'Room name', 'Main', { required: true })],
	},
	{
		id: 'room.list',
		label: 'Room · List',
		description: 'List your rooms',
		fields: [],
	},
	{
		id: 'room.add',
		label: 'Room · Add',
		description: 'Add an account to a room',
		fields: [
			f('room', 'Room name', 'Main', { required: true }),
			f('token', 'User token', 'Token', {
				required: true,
				paragraph: true,
			}),
		],
	},
	{
		id: 'room.remove',
		label: 'Room · Remove',
		description: 'Remove an account slot',
		fields: [
			f('room', 'Room name', 'Main', { required: true }),
			f('slot', 'Slot number', '1', { required: true, maxLength: 4 }),
		],
	},
	{
		id: 'room.delete',
		label: 'Room · Delete',
		description: 'Delete a room',
		fields: [f('room', 'Room name', 'Main', { required: true })],
	},
	{
		id: 'room.renew',
		label: 'Room · Renew',
		description: 'Reset the room timer',
		fields: [f('room', 'Room name', 'Main', { required: true })],
	},
	{
		id: 'token.list',
		label: 'Token · List',
		description: 'List stored tokens',
		fields: [f('type', 'Type (bot/user, optional)', 'user', { maxLength: 4 })],
	},
	{
		id: 'token.add',
		label: 'Token · Add',
		description: 'Register a token',
		fields: [
			f('label', 'Label', 'Main', { required: true }),
			f('token', 'Token', 'Token', { required: true, paragraph: true }),
			f('type', 'Type (bot/user)', 'user', {
				required: true,
				maxLength: 4,
			}),
		],
	},
	{
		id: 'token.import',
		label: 'Token · Import',
		description: 'Import USER_TOKEN from the environment',
		fields: [f('label', 'Label (optional)', 'USER_TOKEN')],
	},
	{
		id: 'token.remove',
		label: 'Token · Remove',
		description: 'Delete a token',
		fields: [f('id', 'Token id', '1', { required: true, maxLength: 8 })],
	},
	{
		id: 'token.check',
		label: 'Token · Check',
		description: 'Validate a token',
		fields: [f('id', 'Token id', '1', { required: true, maxLength: 8 })],
	},
	{
		id: 'admin.setup',
		label: 'Admin · Setup',
		description: 'Show the setup status',
		fields: [],
	},
	{
		id: 'admin.stats',
		label: 'Admin · Stats',
		description: 'Usage statistics',
		fields: [],
	},
	{
		id: 'admin.users',
		label: 'Admin · Users',
		description: 'Known users',
		fields: [],
	},
	{
		id: 'admin.logs',
		label: 'Admin · Logs',
		description: 'Recent audit log',
		fields: [],
	},
	{
		id: 'admin.reload',
		label: 'Admin · Reload',
		description: 'Reload the quest catalogue',
		fields: [],
	},
	{
		id: 'admin.backup',
		label: 'Admin · Backup',
		description: 'Write a database backup',
		fields: [],
	},
	{
		id: 'admin.restore',
		label: 'Admin · Restore',
		description: 'Restore a database backup',
		fields: [f('file', 'Backup file', 'backup.sqlite', { required: true })],
	},
	{
		id: 'admin.maintenance',
		label: 'Admin · Maintenance',
		description: 'Toggle maintenance mode',
		fields: [],
	},
	{
		id: 'admin.config',
		label: 'Admin · Config',
		description: 'Write a configuration value',
		fields: [
			f('key', 'Config key', 'auto.default_account', { required: true }),
			f('value', 'Value', 'Main', { required: true }),
		],
	},
	{
		id: 'admin.purge',
		label: 'Admin · Purge',
		description: 'Delete all data of a user',
		fields: [
			f('userId', 'Discord User ID', '123456789012345678', {
				required: true,
				maxLength: 20,
			}),
		],
	},
	{
		id: 'whitelist.list',
		label: 'Whitelist · List',
		description: 'Show the whitelist',
		fields: [],
	},
	{
		id: 'whitelist.add',
		label: 'Whitelist · Add',
		description: 'Allow a server or user',
		fields: [
			f('kind', 'Kind (guild/user)', 'guild', {
				required: true,
				maxLength: 5,
			}),
			f('id', 'Guild or user ID', '123456789012345678', {
				required: true,
				maxLength: 20,
			}),
			f('label', 'Label (optional)', 'My Server', { maxLength: 100 }),
			f('role', 'Role (member/admin)', 'member', { maxLength: 5 }),
		],
	},
	{
		id: 'whitelist.remove',
		label: 'Whitelist · Remove',
		description: 'Remove an entry',
		fields: [
			f('kind', 'Kind (guild/user)', 'guild', {
				required: true,
				maxLength: 5,
			}),
			f('id', 'Guild or user ID', '123456789012345678', {
				required: true,
				maxLength: 20,
			}),
		],
	},
	{
		id: 'whitelist.role',
		label: 'Whitelist · Role',
		description: 'Change the access role',
		fields: [
			f('kind', 'Kind (guild/user)', 'guild', {
				required: true,
				maxLength: 5,
			}),
			f('id', 'Guild or user ID', '123456789012345678', {
				required: true,
				maxLength: 20,
			}),
			f('role', 'Role (member/admin)', 'admin', {
				required: true,
				maxLength: 5,
			}),
		],
	},
	{
		id: 'whitelist.enable',
		label: 'Whitelist · Enable',
		description: 'Turn the whitelist on',
		fields: [],
	},
	{
		id: 'whitelist.disable',
		label: 'Whitelist · Disable',
		description: 'Turn the whitelist off',
		fields: [],
	},
	{
		id: 'whitelist.sync',
		label: 'Whitelist · Sync',
		description: 'Add every server the bot is in',
		fields: [],
	},
	{
		id: 'quest.auto',
		label: 'Quest · Auto',
		description: 'Complete one quest',
		fields: [f('quest', 'Quest id or name', 'quest-1', { required: true })],
	},
	{
		id: 'quest.all',
		label: 'Quest · All',
		description: 'Run every available quest',
		fields: [],
	},
	{
		id: 'quest.stop',
		label: 'Quest · Stop',
		description: 'Stop the running queue',
		fields: [],
	},
];

const OWNER_PANEL_PAGE = 15;

/** The command picker, paginated because Discord allows 25 options at most. */
export function buildOwnerPanel(page = 0): PanelPayload {
	const pages = Math.max(1, Math.ceil(OWNER_COMMANDS.length / OWNER_PANEL_PAGE));
	const safePage = Math.min(Math.max(page, 0), pages - 1);
	const slice = OWNER_COMMANDS.slice(
		safePage * OWNER_PANEL_PAGE,
		safePage * OWNER_PANEL_PAGE + OWNER_PANEL_PAGE,
	);

	const menu = new StringSelectMenuBuilder()
		.setCustomId(`${OWNER_COMMAND_IDS.select}:${safePage}`)
		.setPlaceholder(`Choose a command (${safePage + 1}/${pages})`)
		.setMinValues(1)
		.setMaxValues(1)
		.setOptions(
			slice.map((command) => ({
				label: command.label.slice(0, 100),
				description: command.description.slice(0, 100),
				value: command.id,
			})),
		);

	return {
		embeds: [ownerPanelEmbed(safePage, pages, OWNER_COMMANDS.length)],
		components: [
			new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(`${OWNER_COMMAND_IDS.prev}:${safePage}`)
					.setLabel('Previous')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(safePage <= 0),
				new ButtonBuilder()
					.setCustomId(`${OWNER_COMMAND_IDS.next}:${safePage}`)
					.setLabel('Next')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(safePage >= pages - 1),
			),
		],
	};
}

/** Opens a modal with the input fields of the selected owner command. */
export function ownerCommandModal(id: string): ModalBuilder | null {
	const command = OWNER_COMMANDS.find((entry) => entry.id === id);
	if (!command || command.fields.length === 0) return null;

	return new ModalBuilder()
		.setCustomId(`${OWNER_COMMAND_IDS.modal}:${id}`)
		.setTitle(command.label.slice(0, 45))
		.addComponents(
			command.fields.slice(0, 5).map((field, index) =>
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId(`field_${index}`)
						.setLabel(field.label.slice(0, 45))
						.setPlaceholder(field.placeholder ?? '')
						.setStyle(
							field.paragraph
								? TextInputStyle.Paragraph
								: TextInputStyle.Short,
						)
						.setRequired(field.required ?? false)
						.setMaxLength(field.maxLength ?? 4000),
				),
			),
		);
}

export type PanelPayload = {
	embeds: ReturnType<typeof questPanelEmbed>[];
	components: ActionRowBuilder<
		StringSelectMenuBuilder | ButtonBuilder
	>[];
};

export type OwnerPanelPayload = {
	embeds: ReturnType<typeof ownerProfileEmbed>[];
	components: ActionRowBuilder<ButtonBuilder>[];
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

/** Builds the owner profile panel with the same shape as the quest panel. */
export function buildOwnerProfilePanel(
	user: User | null,
	hint?: string,
): OwnerPanelPayload {
	return {
		embeds: [ownerProfileEmbed(user, hint)],
		components: [
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(OWNER_PANEL_IDS.input)
					.setLabel('Enter User ID')
					.setStyle(ButtonStyle.Primary),
				new ButtonBuilder()
					.setCustomId(
						`${OWNER_PANEL_IDS.refresh}:${accountSegment(user?.id ?? null)}`,
					)
					.setLabel('Refresh')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(!user),
			),
		],
	};
}

/** The modal used to type the Discord user id into the owner panel. */
export function ownerProfileModal(): ModalBuilder {
	const input = new TextInputBuilder()
		.setCustomId(OWNER_PANEL_IDS.userId)
		.setLabel('Discord User ID')
		.setPlaceholder('123456789012345678')
		.setStyle(TextInputStyle.Short)
		.setMinLength(17)
		.setMaxLength(20)
		.setRequired(true);

	return new ModalBuilder()
		.setCustomId(OWNER_PANEL_IDS.submit)
		.setTitle('Enter User ID')
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(input),
		);
}

/** Resolves a typed id to a Discord user, or null when it is not one. */
export async function fetchOwnerPanelUser(
	services: Services,
	raw: string | undefined,
): Promise<User | null> {
	const id = raw?.trim() ?? '';
	if (!/^\d{17,20}$/.test(id)) return null;

	try {
		return await services.client.users.fetch(id);
	} catch {
		return null;
	}
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
