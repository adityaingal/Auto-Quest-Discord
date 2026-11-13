import { QuestPayload, UserSession } from '../integrations/userSession';
import { QuestTaskType } from '../models/enums';
import { Logger } from '../utils/logger';

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

/**
 * Quest automation against one or more user sessions (optional).
 *
 * The sessions are resolved on every call, so a token that is registered with
 * "/token add" is usable right away - no restart needed.
 */
export class AutoService {
	private stopRequested = false;

	constructor(
		private readonly sessionsProvider: () => SessionEntry[],
	) {}

	/** Asks a running queue to stop after the current quest. */
	requestStop(): void {
		this.stopRequested = true;
	}

	get isStopping(): boolean {
		return this.stopRequested;
	}

	private get sessions(): SessionEntry[] {
		try {
			return this.sessionsProvider();
		} catch {
			return [];
		}
	}

	get enabled(): boolean {
		return this.sessions.length > 0;
	}

	get accounts(): string[] {
		return this.sessions.map((entry) => entry.label);
	}

	/**
	 * Describes the configured user sessions without revealing a token: the
	 * account name, whether the token still works and how many quests the
	 * account has.
	 */
	async describeSessions(): Promise<
		{
			label: string;
			username: string | null;
			accountId: string | null;
			ok: boolean;
			error: string | null;
			quests: number;
		}[]
	> {
		const described: {
			label: string;
			username: string | null;
			accountId: string | null;
			ok: boolean;
			error: string | null;
			quests: number;
		}[] = [];

		for (const entry of this.sessions) {
			const identity = await entry.session.whoami();
			const quests = await entry.session.listQuests();

			described.push({
				label: entry.label,
				username: identity.data?.username ?? null,
				accountId: identity.data?.id ?? null,
				ok: identity.ok && quests.ok,
				error:
					identity.error ??
					quests.error ??
					(identity.ok ? null : `HTTP ${identity.status}`),
				quests: quests.data?.quests?.length ?? 0,
			});
		}

		return described;
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

	async listLiveQuests(): Promise<{
		quests: QuestPayload[];
		account: string;
	} | null> {
		for (const entry of this.sessions) {			const response = await entry.session.listQuests();

			if (!response.ok || !response.data) {
				Logger.warn(
					`User session "${entry.label}" could not read the quests: ${
						response.error ?? response.status
					}`,
				);
				continue;
			}

			const quests = response.data.quests ?? [];
			if (quests.length === 0) continue;

			return { quests, account: entry.label };
		}

		return null;
	}

	/**
	 * Completes one quest. Video quests follow the pacing rule of the server
	 * (the progress may never run more than 10 seconds ahead of the elapsed
	 * time), play quests are advanced with a heartbeat every minute.
	 */
	async run(
		quest: QuestPayload,
		account?: string,
		onProgress?: ProgressCallback,
	): Promise<AutoRunResult> {
		const session = this.sessionFor(account);

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
				message:
					'No user session is configured. Add one with `/token add` (type user) or set USER_TOKEN in the environment.',
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

		if (!quest.user_status?.enrolled_at) {
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
		}

		if (VIDEO_TASKS.includes(taskType)) {
			return this.runVideoQuest(
				quest,
				taskType,
				target,
				session,
				report,
			);
		}

		if (taskType === 'PLAY_ON_DESKTOP') {
			return this.runPlayQuest(quest, target, session, report);
		}

		return {
			finished: false,
			progress: 0,
			target,
			taskType,
			message: `The task type ${taskType} cannot be automated. Complete it in the Discord client.`,
		};
	}
	private sessionFor(account?: string): UserSession | null {
		if (this.sessions.length === 0) return null;

		if (account) {
			const entry = this.sessions.find(
				(candidate) => candidate.label === account,
			);
			if (entry) return entry.session;
		}

		return this.sessions[0].session;
	}

	private async runVideoQuest(
		quest: QuestPayload,
		taskType: AutoTaskType,
		target: number,
		session: UserSession,
		report: (value: number, state: AutoProgress['state']) => void,
	): Promise<AutoRunResult> {
		const enrolledAt = new Date(
			quest.user_status?.enrolled_at ?? Date.now(),
		).getTime();

		let secondsDone = quest.user_status?.progress?.[taskType]?.value ?? 0;
		let completed = false;

		const maxFuture = 10;
		const speed = 7;
		const interval = 1;

		while (secondsDone < target) {
			if (this.stopRequested) {
				return {
					finished: false,
					progress: secondsDone,
					target,
					taskType,
					message: 'The queue was stopped.',
				};
			}

			const maxAllowed =
				Math.floor((Date.now() - enrolledAt) / 1000) + maxFuture;

			if (maxAllowed - secondsDone >= speed) {
				const response = await session.videoProgress(
					quest.id,
					Math.min(target, secondsDone + speed + Math.random()),
				);

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
					(response.data as { completed_at?: string | null })
						?.completed_at,
				);
				secondsDone = Math.min(target, secondsDone + speed);
				report(secondsDone, 'running');
			}

			await new Promise((resolve) =>
				setTimeout(resolve, interval * 1000),
			);
		}

		if (!completed) {
			await session.videoProgress(quest.id, target);
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
		quest: QuestPayload,
		target: number,
		session: UserSession,
		report: (value: number, state: AutoProgress['state']) => void,
	): Promise<AutoRunResult> {
		const applicationId = quest.config.application.id;

		for (;;) {
			if (this.stopRequested) {
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

			await new Promise((resolve) => setTimeout(resolve, 60_000));
		}
	}

	/**
	 * Runs every quest that can be automated, one after another. The callback
	 * receives the live progress of the quest that is currently running.
	 */
	async runAll(
		onProgress?: (
			quest: QuestPayload,
			progress: AutoProgress,
			index: number,
			total: number,
		) => void,
	): Promise<{
		completed: number;
		failed: number;
		skipped: number;
		results: { quest: string; message: string; finished: boolean }[];
	}> {
		this.stopRequested = false;

		const live = await this.listLiveQuests();
		const results: { quest: string; message: string; finished: boolean }[] =
			[];
		let completed = 0;
		let failed = 0;
		let skipped = 0;

		if (!live) {
			return { completed, failed, skipped, results };
		}

		const queue = live.quests.filter((quest) => {
			const expiresAt = quest.config.expires_at
				? new Date(quest.config.expires_at).getTime()
				: null;

			if (expiresAt && expiresAt <= Date.now()) return false;
			if (quest.user_status?.completed_at) return false;

			const task = AutoService.resolveTask(quest);
			return task.type !== null && AUTOMATABLE.includes(task.type);
		});

		for (const [index, quest] of queue.entries()) {
			const name = quest.config.messages.quest_name;

			const result = await this.run(quest, live.account, (progress) =>
				onProgress?.(quest, progress, index, queue.length),
			);

			results.push({
				quest: name,
				message: result.message,
				finished: result.finished,
			});

			if (result.finished) completed++;
			else if (this.stopRequested) skipped++;
			else failed++;

			if (this.stopRequested) break;
		}

		return { completed, failed, skipped, results };
	}
}
