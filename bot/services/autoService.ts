import { QuestPayload, UserSession } from '../integrations/userSession';
import { QuestTaskType } from '../models/enums';
import { Logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { AccountScope, OPERATOR_SCOPE } from './scope';

export type AutoTaskType =
	| 'WATCH_VIDEO'
	| 'WATCH_VIDEO_ON_MOBILE'
	| 'PLAY_ON_DESKTOP'
	| 'STREAM_ON_DESKTOP'
	| 'PLAY_ACTIVITY'
	| 'PLAY_ON_XBOX'
	| 'PLAY_ON_PLAYSTATION'
	| 'ACHIEVEMENT_IN_GAME'
	| 'ACHIEVEMENT_IN_ACTIVITY';

export type AutoProgress = {
	value: number;
	target: number;
	taskType: string | null;
	state: 'queued' | 'running' | 'done' | 'failed' | 'skipped';
	message?: string;
};

export type ProgressCallback = (progress: AutoProgress) => void;

const VIDEO_TASKS: AutoTaskType[] = [
	'WATCH_VIDEO',
	'WATCH_VIDEO_ON_MOBILE',
];

/** The task types the automation can actually complete. */
const AUTOMATABLE: AutoTaskType[] = [
	QuestTaskType.WATCH_VIDEO,
	QuestTaskType.WATCH_VIDEO_ON_MOBILE,
	QuestTaskType.PLAY_ON_DESKTOP,
];

/** How many seconds of video progress are sent per request. */
const VIDEO_STEP_SECONDS = 5;

/**
 * Discord never accepts a video progress that runs more than this many
 * seconds ahead of the time that passed since the enrolment.
 */
const VIDEO_MAX_AHEAD_SECONDS = 10;

/** How often the video progress is checked. */
const VIDEO_TICK_MS = 1000;

export type AutoRunResult = {
	finished: boolean;
	progress: number;
	target: number;
	taskType: string | null;
	message: string;
};

export type SessionEntry = {
	label: string;
	session: UserSession;
};

/** One quest of one account - the unit the queue works on. */
export type QueueJob = {
	account: string;
	quest: QuestPayload;
};

/**
 * The account the commands work with when nothing else is selected. The
 * implementation is optional - without it the bot simply uses every account.
 *
 * The selection belongs to a scope, so every user picks their own account.
 */
export type AutoSettings = {
	readDefaultAccount(scope: AccountScope): string | null;
	writeDefaultAccount(scope: AccountScope, label: string | null): void;
};

export type RunAllOptions = {
	/** Only this account - every configured account when it is missing. */
	account?: string | null;
	/** Only the quest with this id (or name) - every quest when it is missing. */
	quest?: string;
	/** A queue that was fetched before, so the indexes stay stable. */
	plan?: QueueJob[];
};

export type AccountSummary = {
	label: string;
	username: string | null;
	accountId: string | null;
	ok: boolean;
	error: string | null;
	quests: number;
};

export type AutoRunSummary = {
	completed: number;
	failed: number;
	skipped: number;
	results: {
		quest: string;
		account: string;
		message: string;
		finished: boolean;
	}[];
	accounts: string[];
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Quest automation against one or more user sessions (optional).
 *
 * The sessions are resolved on every call and belong to a scope, so a token
 * that was just added to a room is usable right away - no restart needed -
 * and one user never reaches the accounts of another one.
 *
 * Every account can be worked on at the same time: the quests of all accounts
 * are started together, so a video quest that needs five minutes is finished
 * after five minutes and not after five minutes per account.
 */
export class AutoService {
	private readonly stopRequested = new Set<string>();
	private readonly running = new Set<string>();

	constructor(
		private readonly sessionsProvider: (
			scope: AccountScope,
		) => SessionEntry[],
		private readonly settings?: AutoSettings,
	) {}

	/** The key the running state of a scope is stored under. */
	private static key(scope: AccountScope): string {
		return scope.userId;
	}

	/** Asks a running queue to stop after the current quest. */
	requestStop(scope: AccountScope = OPERATOR_SCOPE): void {
		this.stopRequested.add(AutoService.key(scope));
	}

	isStopping(scope: AccountScope = OPERATOR_SCOPE): boolean {
		return this.stopRequested.has(AutoService.key(scope));
	}

	/** True while a queue is running. */
	isRunning(scope: AccountScope = OPERATOR_SCOPE): boolean {
		return this.running.has(AutoService.key(scope));
	}

	private resolveSessions(scope: AccountScope): SessionEntry[] {
		try {
			return this.sessionsProvider(scope) ?? [];
		} catch {
			return [];
		}
	}

	private sessionsOf(scope: AccountScope): SessionEntry[] {
		return this.resolveSessions(scope);
	}

	enabled(scope: AccountScope = OPERATOR_SCOPE): boolean {
		return this.resolveSessions(scope).length > 0;
	}

	accounts(scope: AccountScope = OPERATOR_SCOPE): string[] {
		return this.resolveSessions(scope).map((entry) => entry.label);
	}

	/**
	 * The account the commands use when no account is named. Null means "every
	 * account" - they then all run at the same time.
	 */
	defaultAccount(scope: AccountScope = OPERATOR_SCOPE): string | null {
		const stored = this.settings?.readDefaultAccount(scope) ?? null;
		if (!stored) return null;

		// A removed token must not stay selected.
		return this.accounts(scope).includes(stored) ? stored : null;
	}

	/**
	 * Selects the account the commands work with. `null` clears the
	 * selection, then every account is used at the same time.
	 */
	setDefaultAccount(
		scope: AccountScope,
		label: string | null,
	): void {
		if (label === null) {
			this.settings?.writeDefaultAccount(scope, null);
			return;
		}

		const clean = label.trim();
		if (!clean) {
			this.settings?.writeDefaultAccount(scope, null);
			return;
		}

		if (!this.accounts(scope).includes(clean)) {
			throw new ValidationError(
				`There is no account called "${clean}". Use "/quest sessions" to see the available accounts.`,
			);
		}

		this.settings?.writeDefaultAccount(scope, clean);
	}

	/**
	 * The account a command should work with: the named one, otherwise the
	 * default account, otherwise null (every account).
	 */
	resolveAccount(
		scope: AccountScope,
		explicit?: string | null,
	): string | null {
		const wanted = explicit?.trim();
		if (!wanted) return this.defaultAccount(scope);

		if (!this.accounts(scope).includes(wanted)) {
			throw new ValidationError(
				`There is no account called "${wanted}". Use "/quest sessions" to see the available accounts.`,
			);
		}

		return wanted;
	}

	/**
	 * Describes the configured user sessions without revealing a token: the
	 * account name, whether the token still works and how many quests the
	 * account has.
	 */
	async describeSessions(
		scope: AccountScope = OPERATOR_SCOPE,
	): Promise<AccountSummary[]> {
		return Promise.all(
			this.sessionsOf(scope).map(async (entry) => {
				const [identity, quests] = await Promise.all([
					entry.session.whoami(),
					entry.session.listQuests(),
				]);

				return {
					label: entry.label,
					username: identity.data?.username ?? null,
					accountId: identity.data?.id ?? null,
					ok: identity.ok && quests.ok,
					error:
						identity.error ??
						quests.error ??
						(identity.ok ? null : `HTTP ${identity.status}`),
					quests: quests.data?.quests?.length ?? 0,
				};
			}),
		);
	}

	static mergedTasks(quest: QuestPayload): Record<string, { target: number }> {
		return {
			...(quest.config.task_config?.tasks ?? {}),
			...(quest.config.task_config_v2?.tasks ?? {}),
		};
	}

	/**
	 * Picks the task the automation should work on: a video or play task is
	 * preferred over console only tasks, no matter in which order Discord
	 * lists them.
	 */
	static resolveTask(quest: QuestPayload): {
		type: AutoTaskType | null;
		target: number;
	} {
		const tasks = AutoService.mergedTasks(quest);

		for (const type of AUTOMATABLE) {
			if (tasks[type]) {
				return { type, target: tasks[type].target ?? 0 };
			}
		}

		const first = Object.keys(tasks)[0];
		return {
			type: (first as AutoTaskType) ?? null,
			target: first ? (tasks[first].target ?? 0) : 0,
		};
	}

	static taskTypeOf(quest: QuestPayload): AutoTaskType | null {
		return AutoService.resolveTask(quest).type;
	}

	static targetOf(quest: QuestPayload): number {
		return AutoService.resolveTask(quest).target;
	}

	/**
	 * Whether the automation can work on this quest at all.
	 */
	static isRunnable(quest: QuestPayload): boolean {
		const expiresAt = quest.config.expires_at
			? new Date(quest.config.expires_at).getTime()
			: null;

		if (expiresAt && expiresAt <= Date.now()) return false;
		if (quest.user_status?.completed_at) return false;

		const task = AutoService.resolveTask(quest);
		return task.type !== null && AUTOMATABLE.includes(task.type);
	}

	/**
	 * Whether a quest matches the id or the name a user typed.
	 */
	static matchesQuest(quest: QuestPayload, wanted: string): boolean {
		const needle = wanted.trim().toLowerCase();
		if (!needle) return true;

		return (
			quest.id.toLowerCase() === needle ||
			quest.config.messages.quest_name.toLowerCase().includes(needle)
		);
	}

	/**
	 * The live quests of one account. Without a named account the first
	 * working session of the scope is used.
	 */
	async listLiveQuests(
		scope: AccountScope,
		account?: string | null,
	): Promise<{
		quests: QuestPayload[];
		account: string;
	} | null> {
		const wanted = account?.trim();
		const entries = this.sessionsOf(scope);

		if (wanted) {
			const entry = entries.find(
				(candidate) => candidate.label === wanted,
			);
			if (!entry) return null;

			const response = await entry.session.listQuests();
			if (!response.ok || !response.data) {
				Logger.warn(
					`User session "${entry.label}" could not read the quests: ${
						response.error ?? response.status
					}`,
				);
				return null;
			}

			return {
				quests: response.data.quests ?? [],
				account: entry.label,
			};
		}

		for (const entry of entries) {
			const response = await entry.session.listQuests();

			if (!response.ok || !response.data) {
				Logger.warn(
					`User session "${entry.label}" could not read the quests: ${
						response.error ?? response.status
					}`,
				);
				continue;
			}

			return {
				quests: response.data.quests ?? [],
				account: entry.label,
			};
		}

		return null;
	}

	/**
	 * The live quests of every account - read in parallel so all accounts
	 * answer at the same time.
	 */
	async listAllLiveQuests(
		scope: AccountScope = OPERATOR_SCOPE,
	): Promise<
		{ account: string; quests: QuestPayload[]; error: string | null }[]
	> {
		return Promise.all(
			this.sessionsOf(scope).map(async (entry) => {
				const response = await entry.session.listQuests();

				if (!response.ok || !response.data) {
					Logger.warn(
						`User session "${entry.label}" could not read the quests: ${
							response.error ?? response.status
						}`,
					);

					return {
						account: entry.label,
						quests: [] as QuestPayload[],
						error: response.error ?? `HTTP ${response.status}`,
					};
				}

				return {
					account: entry.label,
					quests: response.data.quests ?? [],
					error: null,
				};
			}),
		);
	}

	/**
	 * The queue the automation is going to run: every runnable quest of every
	 * selected account.
	 */
	async planQueue(
		scope: AccountScope,
		options: RunAllOptions = {},
	): Promise<QueueJob[]> {
		const entries = this.targetSessions(scope, options.account);
		if (entries.length === 0) return [];

		const lists = await Promise.all(
			entries.map(async (entry) => {
				const response = await entry.session.listQuests();

				if (!response.ok || !response.data) {
					Logger.warn(
						`User session "${entry.label}" could not read the quests: ${
							response.error ?? response.status
						}`,
					);

					return {
						account: entry.label,
						quests: [] as QuestPayload[],
					};
				}

				return {
					account: entry.label,
					quests: response.data.quests ?? [],
				};
			}),
		);

		const jobs: QueueJob[] = [];

		for (const list of lists) {
			for (const quest of list.quests) {
				if (!AutoService.isRunnable(quest)) continue;
				if (options.quest && !AutoService.matchesQuest(quest, options.quest)) {
					continue;
				}

				jobs.push({ account: list.account, quest });
			}
		}

		return jobs;
	}

	/**
	 * Completes one quest. Video quests follow the pacing rule of the server
	 * (the progress may never run more than 10 seconds ahead of the elapsed
	 * time), play quests are advanced with a heartbeat every minute.
	 */
	async run(
		scope: AccountScope,
		quest: QuestPayload,
		account?: string | null,
		onProgress?: ProgressCallback,
	): Promise<AutoRunResult> {
		const session = this.sessionFor(scope, account);

		return this.runWithSession(
			scope,
			quest,
			session,
			account ?? null,
			onProgress,
		);
	}

	private sessionFor(
		scope: AccountScope,
		account?: string | null,
	): UserSession | null {
		const sessions = this.sessionsOf(scope);
		if (sessions.length === 0) return null;

		if (account) {
			const entry = sessions.find(
				(candidate) => candidate.label === account,
			);
			return entry?.session ?? null;
		}

		return sessions[0].session;
	}

	/**
	 * The accounts the queue works on: the named one, otherwise every
	 * configured account.
	 */
	private targetSessions(
		scope: AccountScope,
		account?: string | null,
	): SessionEntry[] {
		const sessions = this.sessionsOf(scope);
		if (!account) return sessions;

		const entry = sessions.find((candidate) => candidate.label === account);
		return entry ? [entry] : [];
	}

	private async runWithSession(
		scope: AccountScope,
		quest: QuestPayload,
		session: UserSession | null,
		account: string | null,
		onProgress?: ProgressCallback,
	): Promise<AutoRunResult> {
		const taskType = AutoService.taskTypeOf(quest);
		const target = AutoService.targetOf(quest);

		const report = (value: number, state: AutoProgress['state'], message?: string) =>
			onProgress?.({
				value,
				target,
				taskType,
				state,
				message,
			});

		report(quest.user_status?.progress?.[taskType ?? '']?.value ?? 0, 'running');

		if (!taskType) {
			return {
				finished: false,
				progress: 0,
				target: 0,
				taskType: null,
				message: 'This quest has no task configuration.',
			};
		}

		// Expired quests still show up in the live list - do not try them.
		const expiresAt = quest.config.expires_at
			? new Date(quest.config.expires_at).getTime()
			: null;

		if (expiresAt && expiresAt <= Date.now()) {
			return {
				finished: false,
				progress: 0,
				target,
				taskType,
				message: `This quest expired on ${new Date(
					expiresAt,
				).toUTCString()}.`,
			};
		}

		if (!session) {
			return {
				finished: false,
				progress: 0,
				target,
				taskType,
				message: account
					? `There is no usable session for the account "${account}".`
					: 'No user session is configured. Add one with `/room add` (or `/token add` for the operator).',
			};
		}

		if (!AUTOMATABLE.includes(taskType)) {
			return {
				finished: false,
				progress: 0,
				target,
				taskType,
				message: `The task type ${taskType} cannot be automated. Complete it in the Discord client.`,
			};
		}

		// The enrolment decides when the pacing of a video quest starts, so it
		// is done before the first progress request.
		let enrolledAt = quest.user_status?.enrolled_at
			? new Date(quest.user_status.enrolled_at).getTime()
			: null;

		if (!enrolledAt) {
			const enroll = await session.enroll(quest.id);
			if (!enroll.ok) {
				return {
					finished: false,
					progress: 0,
					target,
					taskType,
					message: `Enrolling failed: ${enroll.error ?? enroll.status}`,
				};
			}

			enrolledAt = Date.now();
		}

		if (VIDEO_TASKS.includes(taskType)) {
			return this.runVideoQuest(
				scope,
				quest,
				taskType,
				target,
				enrolledAt,
				session,
				report,
			);
		}

		if (taskType === 'PLAY_ON_DESKTOP') {
			return this.runPlayQuest(
				scope,
				quest,
				target,
				session,
				report,
			);
		}

		return {
			finished: false,
			progress: 0,
			target,
			taskType,
			message: `The task type ${taskType} cannot be automated. Complete it in the Discord client.`,
		};
	}

	private async runVideoQuest(
		scope: AccountScope,
		quest: QuestPayload,
		taskType: AutoTaskType,
		target: number,
		enrolledAt: number,
		session: UserSession,
		report: (value: number, state: AutoProgress['state']) => void,
	): Promise<AutoRunResult> {
		let secondsDone = quest.user_status?.progress?.[taskType]?.value ?? 0;
		let completed = Boolean(quest.user_status?.completed_at);

		while (secondsDone < target) {
			if (this.isStopping(scope)) {
				return {
					finished: false,
					progress: secondsDone,
					target,
					taskType,
					message: 'The queue was stopped.',
				};
			}

			// The server only accepts a progress that is at most
			// VIDEO_MAX_AHEAD_SECONDS ahead of the elapsed time.
			const elapsed = Math.floor((Date.now() - enrolledAt) / 1000);
			const allowed = Math.min(
				target,
				elapsed + VIDEO_MAX_AHEAD_SECONDS,
			);
			const remaining = allowed - secondsDone;

			if (remaining >= VIDEO_STEP_SECONDS || allowed === target) {
				const next =
					allowed === target && remaining < VIDEO_STEP_SECONDS
						? target
						: Math.min(allowed, secondsDone + VIDEO_STEP_SECONDS);

				const response = await session.videoProgress(quest.id, next);

				if (!response.ok) {
					return {
						finished: false,
						progress: secondsDone,
						target,
						taskType,
						message: `The video progress was rejected: ${
							response.error ?? response.status
						}`,
					};
				}

				const status = response.data as {
					completed_at?: string | null;
					progress?: Record<string, { value?: number }>;
				} | null;

				completed = Boolean(status?.completed_at);

				const serverValue = status?.progress?.[taskType]?.value;
				secondsDone =
					typeof serverValue === 'number' && serverValue > secondsDone
						? serverValue
						: next;

				report(secondsDone, 'running');

				if (completed) break;
			}

			await sleep(VIDEO_TICK_MS);
		}

		if (!completed) {
			const response = await session.videoProgress(quest.id, target);

			if (!response.ok) {
				return {
					finished: false,
					progress: secondsDone,
					target,
					taskType,
					message: `The video progress was rejected: ${
						response.error ?? response.status
					}`,
				};
			}

			completed = Boolean(
				(response.data as { completed_at?: string | null } | null)
					?.completed_at,
			);
		}

		report(target, 'done');

		return {
			finished: true,
			progress: target,
			target,
			taskType,
			message: `The quest "${quest.config.messages.quest_name}" is completed. Claim the reward in the Discord client (Discord asks for a captcha there).`,
		};
	}

	private async runPlayQuest(
		scope: AccountScope,
		quest: QuestPayload,
		target: number,
		session: UserSession,
		report: (value: number, state: AutoProgress['state']) => void,
	): Promise<AutoRunResult> {
		const applicationId = quest.config.application.id;

		for (;;) {
			if (this.isStopping(scope)) {
				return {
					finished: false,
					progress: 0,
					target,
					taskType: 'PLAY_ON_DESKTOP',
					message: 'The queue was stopped.',
				};
			}

			const response = await session.heartbeat(
				quest.id,
				applicationId,
				false,
			);

			if (!response.ok) {
				return {
					finished: false,
					progress: 0,
					target,
					taskType: 'PLAY_ON_DESKTOP',
					message: `The heartbeat was rejected: ${
						response.error ?? response.status
					}`,
				};
			}

			const status = response.data as {
				completed_at?: string | null;
				progress?: Record<string, { value: number }>;
			};

			const progress = status?.progress?.PLAY_ON_DESKTOP?.value ?? 0;
			report(progress, 'running');

			if (status?.completed_at) {
				await session.heartbeat(quest.id, applicationId, true);
				report(target, 'done');

				return {
					finished: true,
					progress: target,
					target,
					taskType: 'PLAY_ON_DESKTOP',
					message: `The quest "${quest.config.messages.quest_name}" is completed. Claim the reward in the Discord client.`,
				};
			}

			Logger.info(`Heartbeat ${quest.id}: ${progress}/${target}s`);

			await sleep(60_000);
		}
	}

	/**
	 * Runs every quest that can be automated. The quests of all accounts start
	 * at the same time, so the whole queue takes as long as its slowest quest
	 * and not as long as the sum of all of them.
	 */
	async runAll(
		scope: AccountScope,
		onProgress?: (
			quest: QuestPayload,
			progress: AutoProgress,
			index: number,
			total: number,
			account: string,
		) => void,
		options: RunAllOptions = {},
	): Promise<AutoRunSummary> {
		const key = AutoService.key(scope);

		if (this.running.has(key)) {
			throw new ValidationError(
				'A quest queue is already running - stop it first.',
			);
		}

		this.running.add(key);
		this.stopRequested.delete(key);

		try {
			const jobs = options.plan ?? (await this.planQueue(scope, options));

			const summary: AutoRunSummary = {
				completed: 0,
				failed: 0,
				skipped: 0,
				results: [],
				accounts: jobs.length
					? [...new Set(jobs.map((job) => job.account))]
					: this.targetSessions(scope, options.account).map(
							(entry) => entry.label,
						),
			};

			if (jobs.length === 0) return summary;

			const sessions = new Map(
				this.sessionsOf(scope).map((entry) => [
					entry.label,
					entry.session,
				]),
			);

			// Every quest of every account starts now - they run in parallel.
			const results = await Promise.all(
				jobs.map(async (job, index) => {
					const result = await this.runWithSession(
						scope,
						job.quest,
						sessions.get(job.account) ?? null,
						job.account,
						(progress) =>
							onProgress?.(
								job.quest,
								progress,
								index,
								jobs.length,
								job.account,
							),
					);

					return {
						quest: job.quest.config.messages.quest_name,
						account: job.account,
						message: result.message,
						finished: result.finished,
					};
				}),
			);

			for (const result of results) {
				summary.results.push(result);

				if (result.finished) summary.completed++;
				else if (this.isStopping(scope)) summary.skipped++;
				else summary.failed++;
			}

			return summary;
		} finally {
			this.running.delete(key);
		}
	}
}
