import { EmbedBuilder, type User } from 'discord.js';
import {
	ELIGIBILITY_LABELS,
	PLATFORM_NAMES,
	QuestEligibility,
	REWARD_TYPE_NAMES,
} from '../models/enums';
import { QuestDetail, QuestView } from '../models/quest';
import {
	COLORS,
	EMOJI,
	formatDuration,
	relativeTime,
	renderProgressBar,
} from './theme';

const STATUS_EMOJI: Record<QuestEligibility, string> = {
	[QuestEligibility.AVAILABLE]: EMOJI.available,
	[QuestEligibility.ENROLLED]: EMOJI.enrolled,
	[QuestEligibility.IN_PROGRESS]: EMOJI.inProgress,
	[QuestEligibility.COMPLETED]: EMOJI.completed,
	[QuestEligibility.EXPIRED]: EMOJI.expired,
	[QuestEligibility.UNAVAILABLE]: EMOJI.unavailable,
};

const STATUS_COLOR: Record<QuestEligibility, number> = {
	[QuestEligibility.AVAILABLE]: COLORS.primary,
	[QuestEligibility.ENROLLED]: COLORS.info,
	[QuestEligibility.IN_PROGRESS]: COLORS.warning,
	[QuestEligibility.COMPLETED]: COLORS.success,
	[QuestEligibility.EXPIRED]: COLORS.danger,
	[QuestEligibility.UNAVAILABLE]: COLORS.neutral,
};

export function eligibilityLabel(quest: {
	eligibility: QuestEligibility;
}): string {
	return `${STATUS_EMOJI[quest.eligibility]} ${
		ELIGIBILITY_LABELS[quest.eligibility]
	}`;
}

export function questListEmbed(
	quests: QuestView[],
	source: string,
	live: boolean,
): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle('QUEST COMPLETER')
		.setDescription(
			`Showing **${quests.length}** quest${
				quests.length === 1 ? '' : 's'
			} from the **${source}** source.`,
		)
		.setFooter({
			text: live
				? 'Live data - use the dropdown to inspect a quest'
				: 'Catalogue snapshot - link an account for live state',
		})
		.setTimestamp();

	const lines = quests.slice(0, 10).map((quest) => {
		const platform = quest.platforms
			.map((id) => PLATFORM_NAMES[id] ?? `Platform ${id}`)
			.join(', ');

		return `${STATUS_EMOJI[quest.eligibility]} **${quest.name}**\n` +
			`\`${quest.id}\` - ${quest.applicationName ?? 'unknown app'} - ${
				platform || 'no platform'
			}`;
	});

	if (lines.length === 0) {
		embed.setDescription('No quests are currently available.');
		return embed;
	}

	embed.addFields({
		name: 'Available quests',
		value: lines.join('\n\n').slice(0, 1024),
	});

	if (quests.length > 10) {
		embed.addFields({
			name: 'More',
			value: `${quests.length - 10} further quests - use the dropdown to see them.`,
		});
	}

	return embed;
}

export function questDetailEmbed(quest: QuestDetail): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setColor(STATUS_COLOR[quest.eligibility])
		.setTitle(`QUEST: ${quest.name}`)
		.setDescription(
			`${quest.gameTitle ?? 'Unknown game'}${
				quest.publisher ? ` - ${quest.publisher}` : ''
			}`,
		)
		.addFields(
			{
				name: 'Status',
				value: eligibilityLabel(quest),
				inline: true,
			},
			{
				name: 'Application ID',
				value: quest.applicationId ? `\`${quest.applicationId}\`` : 'unknown',
				inline: true,
			},
			{
				name: 'Platform',
				value:
					quest.platforms
						.map((id) => PLATFORM_NAMES[id] ?? `Platform ${id}`)
						.join(', ') || 'unspecified',
				inline: true,
			},
			{
				name: 'Task types',
				value: quest.taskTypes.length
					? quest.taskTypes.map((type) => `\`${type}\``).join(', ')
					: 'none',
				inline: true,
			},
			{
				name: 'Requirement',
				value: quest.tasks.length
					? quest.tasks
							.map(
								(task) =>
									`\`${task.type}\` - ${formatDuration(task.target)}`,
							)
							.join('\n')
					: 'unknown',
				inline: true,
			},
			{
				name: 'Expires',
				value: quest.expiresAt
					? `${new Date(quest.expiresAt).toUTCString()} (${relativeTime(
							quest.expiresAt,
						)})`
					: 'unknown',
				inline: true,
			},
		)
		.setFooter({
			text: `Quest ID ${quest.id} - source: ${quest.source}${
				quest.live ? ' (live)' : ''
			}`,
		})
		.setTimestamp();

	if (quest.progress) {
		embed.addFields({
			name: 'Progress',
			value: `${renderProgressBar(quest.progress.percent)}\n` +
				`${quest.progress.value}s / ${quest.progress.target}s`,
		});
	}

	if (quest.rewards.length > 0) {
		embed.addFields({
			name: 'Rewards',
			value: quest.rewards
				.map((reward) => {
					const type =
						REWARD_TYPE_NAMES[reward.type] ?? `Type ${reward.type}`;
					return `**${reward.name}** (${type})${
						reward.orbQuantity ? ` - ${reward.orbQuantity} Orbs` : ''
					}`;
				})
				.join('\n'),
		});
	}

	return embed;
}

/**
 * The Questor style panel embed. It is the main view of a quest: the banner,
 * the reward, the requirements, the progress and the account status.
 */
export function questPanelEmbed(
	quest: QuestView,
	accountLabel?: string | null,
	filter?: 'all' | 'videos' | 'games',
): EmbedBuilder {
	const reward = quest.rewards[0] ?? null;
	const rewardText = reward
		? `${reward.name}${
				reward.orbQuantity ? ` - ${reward.orbQuantity} Orbs` : ''
			}`
		: 'none';

	const progress = quest.progress;
	const percent = progress?.percent ?? 0;
	const progressValue = progress
		? `${renderProgressBar(percent)}\n${progress.value}s / ${progress.target}s (${percent}%)`
		: QuestEligibility.COMPLETED === quest.eligibility
			? 'Complete'
			: 'Not started - enroll in the Discord client';

	const tasks = quest.tasks.length
		? quest.tasks
				.map(
					(task) =>
						`\`${task.type}\` - ${formatDuration(task.target)}`,
				)
				.join('\n')
		: 'unknown';

	const embed = new EmbedBuilder()
		.setColor(STATUS_COLOR[quest.eligibility])
		.setTitle('QUEST COMPLETER')
		.setDescription(
			[
				`**${quest.name}**`,
				`${quest.gameTitle ?? quest.applicationName ?? 'Unknown game'}${
					quest.publisher ? ` - ${quest.publisher}` : ''
				}`,
				'',
				eligibilityLabel(quest),
			].join('\n'),
		)
		.addFields(
			{ name: 'Rewards', value: rewardText, inline: true },
			{
				name: 'Task types',
				value: quest.taskTypes.length
					? quest.taskTypes.map((type) => `\`${type}\``).join(', ')
					: 'none',
				inline: true,
			},
			{
				name: 'Account',
				value: accountLabel
					? `\`${accountLabel}\``
					: 'No account linked - /quest access',
				inline: true,
			},
			{ name: 'Requirement', value: tasks, inline: false },
			{ name: 'Progress', value: progressValue, inline: false },
		)
		.setFooter({
			text: `Quest ID ${quest.id} - ${quest.source}${
				quest.live ? ' (live)' : ''
			}`,
		})
		.setTimestamp();

	if (quest.imageUrl) {
		embed.setImage(quest.imageUrl);
	}

	return embed;
}

/** The home view of the unified owner command panel. */
export function ownerPanelEmbed(
	page: number,
	pages: number,
	total: number,
	group?: string,
): EmbedBuilder {
	return new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle(
			group
				? `OWNER PANEL · ${group.toUpperCase()}`
				: 'OWNER CONTROL PANEL',
		)
		.setDescription(
			[
				'Pick a command below, fill in the modal and the result appears here.',
				'The text commands (`!room`, `!token`, `!admin`, `!whitelist`, `!quest`) still work as before.',
			].join('\n\n'),
		)
		.addFields(
			{ name: 'Commands', value: String(total), inline: true },
			{ name: 'Page', value: `${page + 1} / ${pages}`, inline: true },
		)
		.setFooter({
			text: 'Owner + admins - !help lists every text command',
		});
}

/** The result view after an owner command was run from the panel. */
export function ownerPanelResultEmbed(
	label: string,
	text: string,
): EmbedBuilder {
	return new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle(`OWNER PANEL · ${label}`)
		.setDescription(text.slice(0, 4000) || 'Done.');
}

/** The owner profile panel: just the Discord avatar and the username. */
export function ownerProfileEmbed(
	user: User | null,
	hint?: string,
): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle('USER PROFILE');

	if (!user) {
		return embed.setDescription(
			hint ?? 'Select a user with **Enter User ID** to view their profile.',
		);
	}

	const avatar = user.displayAvatarURL({ size: 1024 });

	return embed
		.setDescription(`**${user.username}**\n\`${user.id}\``)
		.setThumbnail(avatar)
		.setImage(avatar);
}

export function progressEmbed(
	entries: {
		questId: string;
		questName: string;
		status: string;
		value: number;
		target: number;
		percent: number;
		updatedAt: string;
	}[],
): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle('PROGRESS')
		.setDescription(
			entries.length
				? 'Recorded progress for your account.'
				: 'No progress recorded yet. Link an account and run `/quest refresh`.',
		)
		.setTimestamp();

	for (const entry of entries.slice(0, 10)) {
		embed.addFields({
			name: entry.questName,
			value: `${renderProgressBar(entry.percent)}\n` +
				`${entry.value}s / ${entry.target}s - ${entry.status}\n` +
				`_updated ${relativeTime(entry.updatedAt)}_`,
		});
	}

	return embed;
}

export type QueueEntry = {
	name: string;
	/** The account the quest belongs to. */
	account: string;
	taskType: string | null;
	value: number;
	target: number;
	state: 'queued' | 'running' | 'done' | 'failed' | 'skipped';
};

/**
 * Live queue view for the Complete All button: one line per quest with a
 * progress bar and the state of the item.
 */
export function questQueueEmbed(
	entries: QueueEntry[],
	accounts: string | string[] | null,
	done = 0,
	total = 0,
): EmbedBuilder {
	const names = accounts
		? Array.isArray(accounts)
			? accounts
			: [accounts]
		: [];

	const embed = new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle('QUEST QUEUE')
		.setDescription(
			names.length === 0
				? 'Working through the quests.'
				: names.length === 1
					? `Working through the quests of **${names[0]}**.`
					: `Working through the quests of **${names.join(
							', ',
						)}** - all accounts started at the same time.`,
		)
		.setTimestamp();

	if (entries.length === 0) {
		embed.setDescription('Nothing to do right now.');
		return embed;
	}

	const icons: Record<QueueEntry['state'], string> = {
		queued: '⏳',
		running: '▶️',
		done: '✅',
		failed: '❌',
		skipped: '⏭️',
	};

	const lines = entries.map((entry, index) => {
		const percent =
			entry.target > 0
				? Math.min(100, Math.round((entry.value / entry.target) * 100))
				: 0;
		const remaining = Math.max(0, entry.target - entry.value);

		return `${icons[entry.state]} **${index + 1}. ${entry.name}** (\`${
			entry.account
		}\`)\n` +
			`\`${entry.taskType ?? 'unknown'}\` ${renderProgressBar(percent, 12)} - ${
				entry.state === 'done'
					? 'done'
					: `${formatDuration(remaining)} left`
			}`;
	});

	embed.addFields({
		name: `Quests (${done}/${total} done)`,
		value: lines.join('\n').slice(0, 1024),
	});

	embed.setFooter({
		text: 'The rewards still have to be claimed in the Discord client.',
	});

	return embed;
}

export function errorEmbed(message: string): EmbedBuilder {
	return new EmbedBuilder()
		.setColor(COLORS.danger)
		.setTitle('Something went wrong')
		.setDescription(message);
}

export function successEmbed(message: string): EmbedBuilder {
	return new EmbedBuilder()
		.setColor(COLORS.success)
		.setTitle('Done')
		.setDescription(message);
}

export function infoEmbed(
	title: string,
	description: string,
	fields: { name: string; value: string; inline?: boolean }[] = [],
): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle(title)
		.setDescription(description)
		.setTimestamp();

	for (const field of fields) {
		embed.addFields({
			name: field.name,
			value: field.value,
			inline: field.inline ?? true,
		});
	}

	return embed;
}

/**
 * The official quest URL of a quest, but only when the catalogue actually
 * published one over https. A missing or non-https link yields null so no
 * button is ever rendered for an unverified target.
 */
export function verifiedQuestUrl(
	quest: { ctaLink?: string | null },
): string | null {
	const raw = quest.ctaLink?.trim();
	if (!raw) return null;

	try {
		const url = new URL(raw);
		return url.protocol === 'https:' ? url.toString() : null;
	} catch {
		return null;
	}
}

/**
 * An invite is displayed only when it is an https Discord invite. A plain
 * string is always safe as text, but it never becomes a clickable button
 * unless it passes this check.
 */
export function verifiedInviteUrl(raw: string | null | undefined): string | null {
	const value = raw?.trim();
	if (!value) return null;

	try {
		const url = new URL(value);
		if (url.protocol !== 'https:') return null;

		const host = url.hostname.toLowerCase();
		if (host === 'discord.gg') return url.toString();
		if (
			(host === 'discord.com' || host === 'www.discord.com') &&
			url.pathname.startsWith('/invite/')
		) {
			return url.toString();
		}

		return null;
	} catch {
		return null;
	}
}

export const ANNOUNCEMENT_BRAND =
	'Quest Completer | Automatic Quest Monitor';

export type AnnouncementMediaOptions = {
	imagesEnabled?: boolean;
	videosEnabled?: boolean;
	fallback?: 'neutral' | 'omit';
	/** Random id used to reconcile a message whose DB write failed. */
	nonce?: string;
};

function platformText(quest: QuestView): string {
	return (
		quest.platforms
			.map((id) => PLATFORM_NAMES[id] ?? `Platform ${id}`)
			.join(', ') || 'unspecified'
	);
}

/**
 * The public "new quest" announcement. It only carries catalogue data -
 * never a token, an account, a user id or any private progress.
 */
export function questAnnouncementEmbed(
	quest: QuestDetail,
	options: AnnouncementMediaOptions = {},
): EmbedBuilder {
	const reward = quest.rewards[0] ?? null;
	const rewardText = reward
		? `${reward.name}${reward.orbQuantity ? ` - ${reward.orbQuantity} Orbs` : ''}`
		: 'none advertised';

	const requirements = quest.tasks.length
		? quest.tasks
				.map((task) => `\`${task.type}\` - ${formatDuration(task.target)}`)
				.join('\n')
		: 'unknown';

	const promo = [
		quest.gameTitle ?? quest.applicationName ?? 'Unknown game',
		quest.publisher ? `by ${quest.publisher}` : null,
		quest.description ?? null,
	]
		.filter(Boolean)
		.join(' - ');

	const images = options.imagesEnabled !== false;
	const videos = options.videosEnabled !== false;
	const image = images ? quest.imageUrl ?? quest.thumbnailUrl : null;
	const video = videos ? quest.videoUrl : null;
	const fields: { name: string; value: string; inline?: boolean }[] = [
		{ name: 'Reward', value: rewardText, inline: true },
		{
			name: 'Platform',
			value: platformText(quest),
			inline: true,
		},
		{
			name: 'Availability',
			value: eligibilityLabel(quest),
			inline: true,
		},
		{ name: 'Task requirements', value: requirements },
		{
			name: 'Expires',
			value: quest.expiresAt
				? `${new Date(quest.expiresAt).toUTCString()} (${relativeTime(
						quest.expiresAt,
					)})`
				: 'unknown',
			inline: true,
		},
	];

	if (video) {
		fields.push({
			name: 'Promotional video',
			value: `[Watch the official video](${video})`,
		});
	} else if (!image && options.fallback !== 'omit') {
		// Factual, not fabricated: Discord published no usable media here.
		fields.push({
			name: 'Media',
			value: 'No promotional media was published for this quest.',
		});
	}

	const footer = [
		ANNOUNCEMENT_BRAND,
		`Quest ID ${quest.id} - source: ${quest.source}${quest.live ? ' (live)' : ''}`,
		options.nonce ? `ref ${options.nonce}` : null,
	]
		.filter(Boolean)
		.join(' | ');

	const embed = new EmbedBuilder()
		.setColor(STATUS_COLOR[quest.eligibility])
		.setTitle(`NEW QUEST: ${quest.name}`)
		.setDescription(promo)
		.addFields(fields)
		.setFooter({ text: footer })
		.setTimestamp();

	if (image) {
		embed.setImage(image);
	}

	const url = verifiedQuestUrl(quest);
	if (url) {
		embed.setURL(url);
	}

	return embed;
}

/** Metadata that travels with an uploaded SQLite snapshot. */
export function webhookBackupEmbed(input: {
	hash: string;
	size: number;
	generatedAt: string;
	schemaVersion: number;
}): EmbedBuilder {
	return new EmbedBuilder()
		.setColor(COLORS.info)
		.setTitle('DATABASE SNAPSHOT')
		.setDescription(
			'Encrypted database snapshot for the Quest Completer bot. ' +
				'It contains account tokens - do not share it.',
		)
		.addFields(
			{ name: 'SHA-256', value: `\`${input.hash}\``, inline: false },
			{ name: 'Size (bytes)', value: String(input.size), inline: true },
			{ name: 'Generated at', value: input.generatedAt, inline: true },
			{ name: 'Schema version', value: String(input.schemaVersion), inline: true },
		)
		.setFooter({ text: ANNOUNCEMENT_BRAND })
		.setTimestamp();
}

/** Shown when DM access is blocked by the mandatory guild membership rule. */
export function membershipRequiredEmbed(
	inviteUrl: string | null,
): EmbedBuilder {
	const invite = verifiedInviteUrl(inviteUrl);

	return new EmbedBuilder()
		.setColor(COLORS.warning)
		.setTitle('SERVER MEMBERSHIP REQUIRED')
		.setDescription(
			`You must join **the support server** before you can use the bot in DMs.${
				invite ? `\n\nJoin: ${invite}` : '\n\nAsk the bot owner for an invite.'
			}`,
		)
		.addFields({
			name: 'Why?',
			value:
				'DM commands are limited to members of the community server. ' +
				'Joining once is enough - leaving and rejoining is detected automatically.',
		})
		.setFooter({ text: ANNOUNCEMENT_BRAND })
		.setTimestamp();
}

/** One line of the public quest list, kept short enough for 25 per embed. */
function publicQuestLine(index: number, quest: QuestView): string {
	const reward = quest.rewards[0];
	const rewardText = reward
		? reward.orbQuantity
			? `${reward.orbQuantity} Orbs`
			: reward.name
		: 'no reward';

	const expires = quest.expiresAt
		? new Date(quest.expiresAt).toISOString().slice(0, 10)
		: 'no date';

	return (
		`**${index + 1}. ${quest.name}** - ` +
		`${STATUS_EMOJI[quest.eligibility]} ${ELIGIBILITY_LABELS[quest.eligibility]} - ` +
		`${rewardText} - ${expires}`
	);
}

/**
 * The public "Available Quests" browser. It shows catalogue entries only -
 * no progress, no accounts, no scope-private data - and is paginated in
 * pages of at most 25 (Discord's embed/dropdown limit).
 */
export function publicQuestListEmbed(
	quests: QuestView[],
	page: number,
	pages: number,
): EmbedBuilder {
	const safePage = Math.min(Math.max(page, 0), Math.max(pages - 1, 0));
	const slice = quests.slice(safePage * 25, safePage * 25 + 25);

	const embed = new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle('AVAILABLE QUESTS')
		.setFooter({
			text: `Page ${safePage + 1}/${Math.max(pages, 1)} - catalogue data only`,
		})
		.setTimestamp();

	if (slice.length === 0) {
		embed.setDescription(
			'No quests are available right now. Use **Refresh** to try again.',
		);
		return embed;
	}

	embed.setDescription(
		slice
			.map((quest, index) => publicQuestLine(safePage * 25 + index, quest))
			.join('\n')
			.slice(0, 4000),
	);

	return embed;
}

/** The detail view of one quest for the public browser. */
export function publicQuestDetailEmbed(quest: QuestDetail): EmbedBuilder {
	const reward = quest.rewards[0] ?? null;

	const embed = new EmbedBuilder()
		.setColor(STATUS_COLOR[quest.eligibility])
		.setTitle(`QUEST: ${quest.name}`)
		.setDescription(
			[
				quest.gameTitle ?? quest.applicationName ?? 'Unknown game',
				quest.publisher ? `by ${quest.publisher}` : null,
			]
				.filter(Boolean)
				.join(' - '),
		)
		.addFields(
			{ name: 'Status', value: eligibilityLabel(quest), inline: true },
			{ name: 'Platform', value: platformText(quest), inline: true },
			{
				name: 'Reward',
				value: reward
					? `${reward.name}${reward.orbQuantity ? ` - ${reward.orbQuantity} Orbs` : ''}`
					: 'none advertised',
				inline: true,
			},
			{
				name: 'Requirements',
				value: quest.tasks.length
					? quest.tasks
							.map(
								(task) =>
									`\`${task.type}\` - ${formatDuration(task.target)}`,
							)
							.join('\n')
					: 'unknown',
			},
			{
				name: 'Expires',
				value: quest.expiresAt
					? `${new Date(quest.expiresAt).toUTCString()} (${relativeTime(
							quest.expiresAt,
						)})`
					: 'unknown',
				inline: true,
			},
		)
		.setFooter({ text: `Quest ID ${quest.id} - source: ${quest.source}` })
		.setTimestamp();

	if (quest.imageUrl) {
		embed.setImage(quest.imageUrl);
	}

	return embed;
}

/**
 * The summary of "Check All Quest Progress". It only counts the caller's
 * own quests; the reply is ephemeral and no reward is ever claimed here.
 */
export function checkProgressEmbed(summary: {
	total: number;
	available: number;
	inProgress: number;
	completed: number;
	expired: number;
	unavailable: number;
	claimable: number;
	live: boolean;
	accounts: string[];
}): EmbedBuilder {
	const lines = [
		summary.live
			? `Refreshed from **${summary.accounts.length}** authenticated account${
					summary.accounts.length === 1 ? '' : 's'
				} (${summary.accounts.join(', ')}).`
			: 'No authenticated account answered - the last recorded progress is shown.',
		'',
		'Progress values come from Discord responses only. Nothing was claimed automatically.',
	];

	return new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle('QUEST PROGRESS CHECK')
		.setDescription(lines.join('\n'))
		.addFields(
			{ name: 'Total quests', value: String(summary.total), inline: true },
			{
				name: 'Available',
				value: String(summary.available),
				inline: true,
			},
			{
				name: 'In progress',
				value: String(summary.inProgress),
				inline: true,
			},
			{
				name: 'Completed',
				value: String(summary.completed),
				inline: true,
			},
			{ name: 'Expired', value: String(summary.expired), inline: true },
			{
				name: 'Claimable rewards',
				value: String(summary.claimable),
				inline: true,
			},
		)
		.setTimestamp();
}
