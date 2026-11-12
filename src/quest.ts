import { QuestTaskConfigType } from './interface';
import type { Quest as QuestShape } from './interface';

export const QUEST_TASK_TYPES: QuestTaskConfigType[] = [
	QuestTaskConfigType.WATCH_VIDEO,
	QuestTaskConfigType.PLAY_ON_DESKTOP,
	QuestTaskConfigType.STREAM_ON_DESKTOP,
	QuestTaskConfigType.PLAY_ACTIVITY,
	QuestTaskConfigType.WATCH_VIDEO_ON_MOBILE,
];

export class Quest {
	private readonly data: QuestShape;

	private constructor(data: QuestShape) {
		this.data = data;
	}

	static create(data: QuestShape): Quest {
		return new Quest(data);
	}

	get id() {
		return this.data.id;
	}

	get config() {
		return this.data.config;
	}

	get userStatus() {
		return this.data.user_status;
	}

	get targetedContent() {
		return this.data.targeted_content;
	}

	get preview(): boolean {
		return this.data.preview;
	}

	/**
	 * Resolves the task this quest can be completed with.
	 * Newer quests only expose `task_config_v2`, older ones only `task_config`.
	 */
	private resolveTask(): { type: QuestTaskConfigType; target: number } | null {
		const sources = [
			this.config?.task_config,
			this.config?.task_config_v2,
		];

		for (const source of sources) {
			const tasks = source?.tasks;
			if (!tasks) continue;

			for (const type of QUEST_TASK_TYPES) {
				const task = tasks[type];
				if (task != null) {
					return { type, target: task.target ?? 0 };
				}
			}
		}

		return null;
	}

	/**
	 * All task names the quest exposes, even the ones that cannot be spoofed.
	 */
	get availableTaskTypes(): string[] {
		const sources = [
			this.config?.task_config,
			this.config?.task_config_v2,
		];

		const names = new Set<string>();
		for (const source of sources) {
			for (const name of Object.keys(source?.tasks ?? {})) {
				names.add(name);
			}
		}

		return [...names];
	}

	/**
	 * The first task type this quest can be completed with, if any is supported.
	 */
	get taskType(): QuestTaskConfigType | undefined {
		return this.resolveTask()?.type;
	}

	/**
	 * The amount of seconds the task requires to be completed.
	 */
	get taskTarget(): number {
		return this.resolveTask()?.target ?? 0;
	}

	/**
	 * The amount of seconds already completed for the quest's task.
	 */
	get progress(): number {
		const type = this.taskType;
		if (!type) return 0;

		return this.userStatus?.progress?.[type]?.value ?? 0;
	}

	isExpired(reference: Date = new Date()): boolean {
		return reference.getTime() > new Date(this.data.config.expires_at).getTime();
	}

	isCompleted(): boolean {
		return Boolean(this.userStatus?.completed_at);
	}

	isEnrolledQuest(): boolean {
		return Boolean(this.userStatus?.enrolled_at);
	}

	hasClaimedRewards(): boolean {
		return Boolean(this.userStatus?.claimed_at);
	}

	updateUserStatus(userStatus: QuestShape['user_status']) {
		this.data.user_status = userStatus;
	}
}
