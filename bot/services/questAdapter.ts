import { Quest } from '../../src/quest';
import type { Quest as QuestShape } from '../../src/interface';
import { QuestPayload } from '../integrations/userSession';
import {
	QuestDetail,
	QuestProgressView,
	QuestRewardView,
	QuestTaskView,
	QuestView,
} from '../models/quest';
import { QuestEligibility } from '../models/enums';

/**
 * Adapter between the existing quest engine (src/quest.ts) and the bot
 * services. All parsing lives in the engine - this file only reshapes it for
 * the Discord UI.
 */

function buildRewards(quest: Quest): QuestRewardView[] {
	const rewards = quest.config?.rewards_config?.rewards ?? [];

	return rewards.map((reward) => ({
		name: reward.messages?.name ?? 'Unknown reward',
		type: reward.type,
		orbQuantity: reward.orb_quantity ?? null,
		redemptionLink: reward.redemption_link ?? null,
		instructions:
			reward.messages?.redemption_instructions_by_platform?.['0'] ?? null,
	}));
}

function buildProgress(quest: Quest): QuestProgressView | null {
	const target = quest.taskTarget;
	const value = quest.progress;
	const status = quest.userStatus;

	if (!status && target === 0) return null;

	const percent =
		target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;

	return {
		value,
		target,
		percent,
		enrolledAt: status?.enrolled_at ?? null,
		completedAt: status?.completed_at ?? null,
		claimedAt: status?.claimed_at ?? null,
	};
}

export function resolveEligibility(quest: Quest): QuestEligibility {
	if (quest.isExpired()) return QuestEligibility.UNAVAILABLE;
	if (quest.isCompleted()) return QuestEligibility.COMPLETED;
	if (quest.progress > 0) return QuestEligibility.IN_PROGRESS;
	if (quest.isEnrolledQuest()) return QuestEligibility.ENROLLED;

	return QuestEligibility.AVAILABLE;
}

export function toQuestView(
	quest: Quest,
	source: string,
	live = false,
): QuestView {
	const tasks: QuestTaskView[] = quest.taskList;
	const targeted = quest.targetedContent;

	return {
		id: quest.id,
		name:
			quest.config?.messages?.quest_name?.trim() || quest.id,
		applicationId: quest.config?.application?.id ?? null,
		applicationName: quest.config?.application?.name ?? null,
		gameTitle: quest.config?.messages?.game_title ?? null,
		publisher: quest.config?.messages?.game_publisher ?? null,
		contentType: Array.isArray(targeted)
			? (targeted[0] ?? null)
			: (targeted ?? null),
		platforms: quest.config?.rewards_config?.platforms ?? [],
		tasks,
		taskTypes: tasks.map((task) => task.type),
		eligibility: resolveEligibility(quest),
		progress: buildProgress(quest),
		rewards: buildRewards(quest),
		expiresAt: quest.config?.expires_at ?? null,
		startsAt: quest.config?.starts_at ?? null,
		source,
		live,
	};
}

export function toQuestDetail(
	quest: Quest,
	source: string,
	live = false,
): QuestDetail {
	const view = toQuestView(quest, source, live);

	return {
		...view,
		description:
			quest.config?.messages?.game_title
				? `${quest.config.messages.game_title} - ${
						quest.config.messages.game_publisher ?? 'unknown publisher'
					}`
				: null,
		sharePolicy: quest.config?.share_policy ?? null,
		ctaLabel: quest.config?.cta_config?.button_label ?? null,
		ctaLink: quest.config?.cta_config?.link ?? null,
	};
}

/**
 * Live quests that were read from a user session are converted with the same
 * engine, so there is exactly one implementation of the parsing rules.
 */
export function toQuestViewFromPayload(
	payload: QuestPayload,
	source = 'user-session',
): QuestView {
	const quest = Quest.create(payload as unknown as QuestShape);

	return toQuestView(quest, source, true);
}
