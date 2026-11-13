import { Repositories } from '../database/repositories';
import { QuestView } from '../models/quest';
import { QuestEligibility } from '../models/enums';
import { Logger } from '../utils/logger';

/**
 * Progress bookkeeping. Values always come from an API response - the bot
 * never invents progress.
 */
export class ProgressService {
	constructor(private readonly repositories: Repositories) {}

	record(discordUserId: string, quest: QuestView): void {
		if (!quest.progress) return;

		const before = this.repositories.getProgress(discordUserId, quest.id);

		this.repositories.saveProgress({
			discord_user_id: discordUserId,
			quest_id: quest.id,
			status: quest.eligibility,
			value: quest.progress.value,
			target: quest.progress.target,
			percent: quest.progress.percent,
			enrolled_at: quest.progress.enrolledAt,
			completed_at: quest.progress.completedAt,
			claimed_at: quest.progress.claimedAt,
		});

		if (!before) {
			this.repositories.addHistory(
				discordUserId,
				quest.id,
				'tracked',
				`${quest.progress.value}/${quest.progress.target}s`,
			);
			return;
		}

		if (
			before.status !== quest.eligibility ||
			before.value !== quest.progress.value
		) {
			this.repositories.addHistory(
				discordUserId,
				quest.id,
				'progress',
				`${before.value}s -> ${quest.progress.value}s (${quest.eligibility})`,
			);
		}
	}

	list(discordUserId: string) {
		return this.repositories.listProgress(discordUserId);
	}

	get(discordUserId: string, questId: string) {
		return this.repositories.getProgress(discordUserId, questId);
	}

	/**
	 * Percentage calculation is centralised here so every command shows the
	 * same number.
	 */
	static percent(value: number, target: number): number {
		if (!target || target <= 0) return 0;
		return Math.min(100, Math.max(0, Math.round((value / target) * 100)));
	}

	isComplete(status: string): boolean {
		return status === QuestEligibility.COMPLETED;
	}

	logChange(
		discordUserId: string,
		questId: string,
		message: string,
	): void {
		Logger.debug(`[${discordUserId}] ${questId}: ${message}`);
		this.repositories.addHistory(discordUserId, questId, 'change', message);
	}
}
