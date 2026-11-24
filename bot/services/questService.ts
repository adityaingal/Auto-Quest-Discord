import { Repositories } from '../database/repositories';
import { CatalogProvider } from '../integrations/catalogProvider';
import { LinkedAccountProvider } from '../integrations/linkedAccountProvider';
import { QuestProvider } from '../integrations/questProvider';
import { QuestDetail, QuestView } from '../models/quest';
import { QuestEligibility } from '../models/enums';
import { toQuestViewFromPayload } from './questAdapter';
import { AutoService } from './autoService';
import { ProgressService } from './progressService';
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

/** The outcome of "Check All Quest Progress" for one scope. */
export type ProgressCheckSummary = {
	total: number;
	available: number;
	inProgress: number;
	completed: number;
	expired: number;
	unavailable: number;
	/** Completed quests whose reward is not claimed yet. */
	claimable: number;
	/** True when at least one authenticated account answered. */
	live: boolean;
	accounts: string[];
	quests: QuestView[];
};

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
	/**
	 * Called after the catalogue was refreshed - the public quest notifier
	 * hooks in here so a new quest is announced right after it appears.
	 * Assigned by the service wiring; never required for correctness.
	 */
	public onRefresh: (() => void) | null = null;

	constructor(
		private readonly repositories: Repositories,
		private readonly catalog: CatalogProvider,
		private readonly linked: LinkedAccountProvider,
		private readonly autoService?: AutoService,
		private readonly progress?: ProgressService,
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
		// The accounts of this scope serve the real quest list. A live
		// source that throws (network, rate limit, revocation) must not
		// break the command - the fallbacks below answer instead.
		let live: Awaited<
			ReturnType<AutoService['listLiveQuests']>
		> = null;
		try {
			live =
				(await this.autoService?.listLiveQuests(
					scope,
					this.liveAccount(scope, account),
				)) ?? null;
		} catch (error) {
			Logger.warn(
				`Live quest list failed, falling back: ${(error as Error).message}`,
			);
		}

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

		// The stored row was written from a Discord response earlier. When
		// the live source temporarily reports nothing but the stored data
		// says the quest is done, the completed state (and its numbers) are
		// restored instead of dropping back to "available" - no value is
		// invented here.
		const storedCompleted =
			stored?.status === QuestEligibility.COMPLETED ||
			Boolean(stored?.completed_at);

		const promotable =
			quest.eligibility === QuestEligibility.AVAILABLE ||
			quest.eligibility === QuestEligibility.ENROLLED ||
			quest.eligibility === QuestEligibility.IN_PROGRESS ||
			quest.eligibility === QuestEligibility.EXPIRED;

		if (storedCompleted && promotable && stored) {
			quest.eligibility = QuestEligibility.COMPLETED;
			quest.progress = {
				value: stored.value,
				target: stored.target,
				percent: stored.percent,
				enrolledAt: stored.enrolled_at,
				completedAt: stored.completed_at,
				claimedAt: stored.claimed_at,
			};
		} else if (stored && !quest.progress) {
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

		if (quest.eligibility === QuestEligibility.EXPIRED) {
			throw new ValidationError(
				'That quest expired and can no longer be started.',
			);
		}

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
	 *
	 * The bundled snapshot is re-read from disk first (so `!admin reload`
	 * really picks up a newer quest.json), then the live quests of **every**
	 * account of the scope are aggregated - one account's view never hides
	 * another account's quests.
	 */
	async refresh(
		scope: AccountScope,
	): Promise<{ quests: QuestView[]; source: string; live: boolean }> {
		try {
			this.catalog.reload();
		} catch (error) {
			Logger.warn(
				`The quest catalogue could not be re-read: ${(error as Error).message}`,
			);
		}

		let quests: QuestView[] = [];
		let source = this.catalog.name;
		let live = false;

		const all = await this.safeAllLive(scope);
		if (all.length > 0) {
			const seen = new Map<string, QuestView>();

			for (const list of all) {
				for (const payload of list.quests) {
					const view = toQuestViewFromPayload(
						payload,
						`user-session (${list.account})`,
					);
					if (!seen.has(view.id)) seen.set(view.id, view);
				}
			}

			quests = [...seen.values()];
			live = true;
			source = `user-session (${all
				.filter((list) => list.quests.length > 0)
				.map((list) => list.account)
				.join(', ')})`;
		}

		if (quests.length === 0) {
			const result = await this.list(scope);
			quests = result.quests;
			source = result.source;
			live = result.live;
		}

		this.repositories.transaction(() => {
			for (const quest of quests) {
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
					source,
					config: JSON.stringify(quest),
				});
			}
		});

		Logger.info(
			`Quest catalogue refreshed (${quests.length} quests, source=${source})`,
		);

		// The public notifier announces quests that were not seen before.
		try {
			this.onRefresh?.();
		} catch (error) {
			Logger.warn(
				`The refresh hook failed: ${(error as Error).message}`,
			);
		}

		return { quests, source, live };
	}

	/** The live quest lists of every account - errors become an empty list. */
	private async safeAllLive(
		scope: AccountScope,
	): Promise<Awaited<ReturnType<AutoService['listAllLiveQuests']>>> {
		if (!this.autoService) return [];

		try {
			return await this.autoService.listAllLiveQuests(scope);
		} catch (error) {
			Logger.warn(
				`Reading the quests of every account failed: ${(error as Error).message}`,
			);
			return [];
		}
	}

	/**
	 * "Check All Quest Progress": refreshes the stored progress of the
	 * caller's own accounts from the authenticated sources, recalculates the
	 * percentages from the verified API values and reports which quests are
	 * completed, claimable or expired. Nothing is ever claimed automatically
	 * and no other scope is touched.
	 */
	async checkAll(scope: AccountScope): Promise<ProgressCheckSummary> {
		const views = new Map<string, QuestView>();
		const accounts: string[] = [];
		let live = false;

		const all = await this.safeAllLive(scope);
		for (const list of all) {
			if (list.error || list.quests.length === 0) continue;
			accounts.push(list.account);
			live = true;

			for (const payload of list.quests) {
				const view = toQuestViewFromPayload(
					payload,
					`user-session (${list.account})`,
				);
				if (!views.has(view.id)) views.set(view.id, view);
			}
		}

		// No authenticated account answered - the last known (stored)
		// progress of this scope is summarised instead of being invented.
		if (views.size === 0) {
			const listed = await this.list(scope);
			for (const quest of listed.quests) views.set(quest.id, quest);
		}

		const quests = [...views.values()];

		// Every value below comes from the API responses that produced the
		// views - record writes them through the single progress path.
		for (const quest of quests) {
			this.progress?.record(scope.userId, quest);
		}

		const count = (status: QuestEligibility) =>
			quests.filter((quest) => quest.eligibility === status).length;

		return {
			total: quests.length,
			available: count(QuestEligibility.AVAILABLE),
			inProgress: count(QuestEligibility.IN_PROGRESS),
			completed: count(QuestEligibility.COMPLETED),
			expired: count(QuestEligibility.EXPIRED),
			unavailable: count(QuestEligibility.UNAVAILABLE),
			claimable: quests.filter(
				(quest) =>
					quest.eligibility === QuestEligibility.COMPLETED &&
					!quest.progress?.claimedAt,
			).length,
			live,
			accounts,
			quests,
		};
	}

	/**
	 * Records the current progress of a quest for a user. The write is
	 * delegated to the ProgressService so there is exactly one path that
	 * persists progress (and it also writes the history entry).
	 */
	recordProgress(
		discordUserId: string,
		quest: QuestView,
	): void {
		this.progress?.record(discordUserId, quest);
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
