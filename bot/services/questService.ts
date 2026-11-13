import { Repositories } from '../database/repositories';
import { CatalogProvider } from '../integrations/catalogProvider';
import { LinkedAccountProvider } from '../integrations/linkedAccountProvider';
import { QuestProvider } from '../integrations/questProvider';
import { QuestDetail, QuestView } from '../models/quest';
import { QuestEligibility } from '../models/enums';
import { toQuestViewFromPayload } from './questAdapter';
import { AutoService } from './autoService';
import { AccountScope } from './scope';
import {
	AuthorizationError,
	IntegrationUnavailableError,
	NotFoundError,
	ValidationError,
} from '../utils/errors';
import { Logger } from '../utils/logger';

/**
 * Errors that mean "the live source cannot answer right now" - the catalogue
 * is used instead.
 */
function isFallbackError(error: unknown): boolean {
	return (
		error instanceof IntegrationUnavailableError ||
		error instanceof AuthorizationError
	);
}

/**
 * Quest orchestration. The parsing stays in the legacy engine (src/quest.ts);
 * this service only combines the providers, persists results and answers the
 * questions the commands ask.
 *
 * Every method works inside a scope. The live data is read from the
 * accounts of that scope, so a user only ever sees their own accounts - the
 * accounts of the operator are never used as a fallback.
 */
export class QuestService {
	constructor(
		private readonly repositories: Repositories,
		private readonly catalog: CatalogProvider,
		private readonly linked: LinkedAccountProvider,
		private readonly autoService?: AutoService,
	) {}

	private get providers(): QuestProvider[] {
		return [this.catalog, this.linked];
	}

	/**
	 * The user session the live data is read from: the named account, the
	 * account selected with "/quest switch" or - when nothing is selected -
	 * the first account of the scope that answers.
	 */
	private liveAccount(
		scope: AccountScope,
		account?: string | null,
	): string | undefined {
		const wanted = account?.trim();
		if (wanted) return wanted;

		return this.autoService?.defaultAccount(scope) ?? undefined;
	}

	/**
	 * Lists quests. Live data is preferred when the scope has an account and
	 * Discord actually serves it, otherwise the catalogue is used.
	 *
	 * `account` selects the user session the live data is read from. Without
	 * it the account selected with "/quest switch" is used.
	 */
	async list(
		scope: AccountScope,
		account?: string | null,
	): Promise<{
		quests: QuestView[];
		source: string;
		live: boolean;
	}> {
		// The accounts of this scope serve the real quest list.
		const live = await this.autoService?.listLiveQuests(
			scope,
			this.liveAccount(scope, account),
		);
		if (live && live.quests.length > 0) {
			return {
				quests: live.quests.map((quest) => toQuestViewFromPayload(quest)),
				source: `user-session (${live.account})`,
				live: true,
			};
		}

		try {
			const quests = await this.linked.listFor(scope.userId);
			return { quests, source: this.linked.name, live: true };
		} catch (error) {
			if (!isFallbackError(error)) throw error;
		}

		const quests = await this.catalog.list();
		return { quests, source: this.catalog.name, live: false };
	}

	async get(
		questId: string,
		scope: AccountScope,
		account?: string | null,
	): Promise<QuestDetail> {
		// Live quests of the accounts of this scope come first - their ids
		// differ from the catalogue snapshot.
		const live = await this.autoService?.listLiveQuests(
			scope,
			this.liveAccount(scope, account),
		);
		const liveQuest = live?.quests.find(
			(entry) =>
				entry.id === questId ||
				entry.config.messages.quest_name
					.toLowerCase()
					.includes(questId.toLowerCase()),
		);

		if (liveQuest) {
			return {
				...toQuestViewFromPayload(liveQuest),
				description:
					liveQuest.config.messages.quest_name ?? null,
				sharePolicy: null,
				ctaLabel: null,
				ctaLink: null,
			};
		}

		try {
			return await this.linked.require(questId, scope.userId);
		} catch (error) {
			if (!isFallbackError(error)) throw error;
		}

		return this.catalog.require(questId);
	}

	async status(
		questId: string,
		scope: AccountScope,
		account?: string | null,
	): Promise<QuestDetail> {
		const quest = await this.get(questId, scope, account);
		const stored = this.repositories.getProgress(scope.userId, questId);

		if (stored && !quest.progress) {
			quest.progress = {
				value: stored.value,
				target: stored.target,
				percent: stored.percent,
				enrolledAt: stored.enrolled_at,
				completedAt: stored.completed_at,
				claimedAt: stored.claimed_at,
			};
		}

		return quest;
	}

	/**
	 * Enrolling is a user-session action that a bot cannot perform. The
	 * command therefore validates eligibility and routes the user to the
	 * official flow instead of pretending to start it.
	 */
	async start(
		questId: string,
		scope: AccountScope,
	): Promise<{ started: boolean; message: string; quest: QuestDetail }> {
		const quest = await this.get(questId, scope);

		if (quest.eligibility === QuestEligibility.UNAVAILABLE) {
			throw new ValidationError(
				'That quest is no longer available (it expired or is not offered to this account).',
			);
		}

		if (quest.eligibility === QuestEligibility.COMPLETED) {
			throw new ValidationError(
				'That quest is already completed. Use `/reward status` to check the reward.',
			);
		}

		this.repositories.addHistory(
			scope.userId,
			questId,
			'start_requested',
			quest.eligibility,
		);

		return {
			started: false,
			message:
				'Enrolling happens in the Discord client. Open Quest Home, pick the quest and press "Start". This bot then tracks its progress and reward.',
			quest,
		};
	}

	/**
	 * Refreshes the stored quest catalogue and returns what changed.
	 */
	async refresh(
		scope: AccountScope,
	): Promise<{ quests: QuestView[]; source: string; live: boolean }> {
		const result = await this.list(scope);

		this.repositories.transaction(() => {
			for (const quest of result.quests) {
				this.repositories.saveQuest({
					quest_id: quest.id,
					name: quest.name,
					application_id: quest.applicationId,
					application_name: quest.applicationName,
					content_type: quest.contentType,
					platforms: JSON.stringify(quest.platforms),
					tasks: JSON.stringify(quest.tasks),
					rewards: JSON.stringify(quest.rewards),
					expires_at: quest.expiresAt,
					source: result.source,
					config: JSON.stringify(quest),
				});
			}
		});

		Logger.info(
			`Quest catalogue refreshed (${result.quests.length} quests, source=${result.source})`,
		);

		return result;
	}

	/**
	 * Records the current progress of a quest for a user.
	 */
	recordProgress(
		discordUserId: string,
		quest: QuestView,
	): void {
		if (!quest.progress) return;

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
	}

	history(discordUserId: string, limit = 15) {
		return this.repositories.listHistory(discordUserId, limit);
	}

	requireQuest(questId: string): void {
		if (!questId) {
			throw new NotFoundError('No quest was selected.');
		}
	}
}
