import { Repositories } from '../database/repositories';
import { LinkedAccountProvider } from '../integrations/linkedAccountProvider';
import { QuestDetail, QuestView } from '../models/quest';
import { REWARD_TYPE_NAMES } from '../models/enums';
import { ValidationError } from '../utils/errors';

export type RewardStatus = {
	questId: string;
	questName: string;
	rewardName: string | null;
	rewardType: number | null;
	rewardTypeName: string | null;
	orbQuantity: number | null;
	eligible: boolean;
	claimed: boolean;
	claimedAt: string | null;
	redemptionLink: string | null;
	instructions: string | null;
};

export class RewardService {
	constructor(
		private readonly repositories: Repositories,
		private readonly linked: LinkedAccountProvider,
	) {}

	buildStatus(quest: QuestView): RewardStatus {
		const reward = quest.rewards[0] ?? null;

		return {
			questId: quest.id,
			questName: quest.name,
			rewardName: reward?.name ?? null,
			rewardType: reward?.type ?? null,
			rewardTypeName:
				reward?.type != null
					? (REWARD_TYPE_NAMES[reward.type] ?? `Type ${reward.type}`)
					: null,
			orbQuantity: reward?.orbQuantity ?? null,
			eligible: quest.eligibility === 'completed',
			claimed: Boolean(quest.progress?.claimedAt),
			claimedAt: quest.progress?.claimedAt ?? null,
			redemptionLink: reward?.redemptionLink ?? null,
			instructions: reward?.instructions ?? null,
		};
	}

	async status(
		questId: string,
		discordUserId: string,
		quest: QuestDetail,
	): Promise<RewardStatus> {
		const status = this.buildStatus(quest);

		const stored = this.repositories
			.listRewards(discordUserId)
			.find((row) => row.quest_id === questId);

		if (stored) {
			status.claimed = stored.status === 'claimed';
			status.claimedAt = stored.claimed_at;
			status.rewardName = status.rewardName ?? stored.reward_name;
			status.orbQuantity = status.orbQuantity ?? stored.orb_quantity;
		}

		this.repositories.saveReward({
			discord_user_id: discordUserId,
			quest_id: questId,
			reward_name: status.rewardName,
			reward_type: status.rewardType,
			orb_quantity: status.orbQuantity,
			status: status.claimed ? 'claimed' : 'eligible',
			claimed_at: status.claimedAt,
		});

		return status;
	}

	list(discordUserId: string) {
		return this.repositories.listRewards(discordUserId);
	}

	/**
	 * Guides the user through the official claim flow. Discord frequently
	 * requires a human captcha verification - that part is never automated.
	 */
	async claim(
		questId: string,
		discordUserId: string,
	): Promise<{ claimed: boolean; message: string }> {
		const result = await this.linked.claim(questId, discordUserId);

		this.repositories.saveReward({
			discord_user_id: discordUserId,
			quest_id: questId,
			reward_name: null,
			reward_type: null,
			orb_quantity: null,
			status: result.claimed ? 'claimed' : 'pending',
			claimed_at: result.claimed ? new Date().toISOString() : null,
		});

		return result;
	}

	async code(
		questId: string,
		discordUserId: string,
	): Promise<{ code: string; platform: number | null }> {
		return this.linked.rewardCode(questId, discordUserId);
	}

	requireClaimable(status: RewardStatus): void {
		if (!status.rewardName) {
			throw new ValidationError(
				'This quest does not advertise a reward.',
			);
		}
	}
}
