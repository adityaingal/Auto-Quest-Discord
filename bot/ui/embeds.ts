import { EmbedBuilder } from 'discord.js';
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
	[QuestEligibility.UNAVAILABLE]: EMOJI.unavailable,
};

const STATUS_COLOR: Record<QuestEligibility, number> = {
	[QuestEligibility.AVAILABLE]: COLORS.primary,
	[QuestEligibility.ENROLLED]: COLORS.info,
	[QuestEligibility.IN_PROGRESS]: COLORS.warning,
	[QuestEligibility.COMPLETED]: COLORS.success,
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
	taskType: string | null;
	value: number;
	target: number;
	state: 'queued' | 'running' | 'done' | 'failed' | 'skipped';
};

/**
 * Live queue view for "/quest all": one line per quest with a progress bar
 * and the remaining time.
 */
export function questQueueEmbed(
	entries: QueueEntry[],
	account: string | null,
	done = 0,
	total = 0,
): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle('QUEST QUEUE')
		.setDescription(
			account
				? `Working through the quests of **${account}**.`
				: 'Working through the quests.',
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

		return `${icons[entry.state]} **${index + 1}. ${entry.name}**\n` +
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
