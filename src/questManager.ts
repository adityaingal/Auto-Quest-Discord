import { ClientQuest } from './client';
import { Constants } from './constants';
import { getCaptchaChallenge, solveCaptcha } from './captcha';
import { QuestTaskConfigType } from './interface';
import type {
	AllQuestsResponse,
	ClaimQuestRewardResponse,
} from './interface';
import { Quest } from './quest';

export class QuestManager implements Iterable<Quest> {
	private readonly quests = new Map<string, Quest>();
	public readonly client: ClientQuest;
	constructor(client: ClientQuest, quests: Quest[] = []) {
		this.client = client;
		quests.forEach((quest) => this.quests.set(quest.id, quest));
	}

	static fromResponse(
		client: ClientQuest,
		response: AllQuestsResponse,
	): QuestManager {
		return new QuestManager(
			client,
			response.quests.map((quest) => Quest.create(quest)),
		);
	}

	[Symbol.iterator](): IterableIterator<Quest> {
		return this.quests.values();
	}

	get size(): number {
		return this.quests.size;
	}

	list(): Quest[] {
		return Array.from(this.quests.values());
	}

	get(id: string): Quest | undefined {
		return this.quests.get(id);
	}

	upsert(quest: Quest): void {
		this.quests.set(quest.id, quest);
	}

	remove(id: string): boolean {
		return this.quests.delete(id);
	}

	clear(): void {
		this.quests.clear();
	}

	getExpired(date: Date = new Date()): Quest[] {
		return this.list().filter((quest) => quest.isExpired(date));
	}

	getCompleted(): Quest[] {
		return this.list().filter((quest) => quest.isCompleted());
	}

	getClaimable(): Quest[] {
		return this.list().filter(
			(quest) => quest.isCompleted() && !quest.hasClaimedRewards(),
		);
	}

	hasQuest(id: string): boolean {
		return this.quests.has(id);
	}

	filterQuestsValid() {
		return this.list().filter(
			(quest) =>
				quest.id !== '1412491570820812933' &&
				!quest.isCompleted() &&
				!quest.isExpired(),
		);
	}

	getApplicationData(ids: string[]) {
		const query = new URLSearchParams();
		ids.forEach((id) => query.append('application_ids', id));
		return this.client.rest.get(`/applications/public`, {
			query,
		}) as Promise<
			{
				// Partial<ApplicationData>
				id: string;
				name: string;
				icon: string;
				description: string;
				executables: {
					os: string;
					name: string;
					is_launcher: boolean;
				}[];
			}[]
		>;
	}

	acceptQuest(questId: string) {
		return this.client.rest
			.post(`/quests/${questId}/enroll`, {
				body: {
					location: 11, // QUEST_HOME_DESKTOP | https://docs.discord.food/resources/quests#quest-content-type
					is_targeted: false,
					metadata_raw: null,
				},
			})
			.then((r) => {
				const quest = this.get(questId);
				quest?.updateUserStatus(r as any);
				return quest;
			});
	}

	async claimReward(quest: Quest): Promise<ClaimQuestRewardResponse> {
		const body = {
			location: 11, // QUEST_HOME_DESKTOP
			platform: 0, // CROSS_PLATFORM
			is_targeted: false,
			metadata_raw: null,
		};

		try {
			const response = await this.client.rest.post(
				`/quests/${quest.id}/claim-reward`,
				{ body },
			);

			return response as ClaimQuestRewardResponse;
		} catch (error) {
			const challenge = getCaptchaChallenge(error);
			if (!challenge) throw error;

			const solution = await solveCaptcha(challenge, Constants.USER_AGENT);
			if (!solution) {
				throw new Error(
					'captcha required - open Discord and click "Claim" to finish it by hand',
				);
			}

			const response = await this.client.rest.post(
				`/quests/${quest.id}/claim-reward`,
				{ body, headers: { 'X-Captcha-Key': solution } },
			);

			return response as ClaimQuestRewardResponse;
		}
	}

	private async timeout(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async doingQuest(quest: Quest) {
		const questName = quest.config.messages.quest_name;
		if (!quest.isEnrolledQuest()) {
			console.log(`Enrolling in quest "${questName}"...`);
			await this.acceptQuest(quest.id);
		}
		const applicationName = quest.config.application.name;
		const taskName = quest.taskType;
		if (!taskName) {
			const available = quest.availableTaskTypes;
			throw new Error(
				`Quest "${questName}" has no supported task type (${
					available.length > 0 ? available.join(', ') : 'none'
				})`,
			);
		}
		const secondsNeeded = quest.taskTarget;
		let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;
		if (
			taskName === QuestTaskConfigType.WATCH_VIDEO ||
			taskName === QuestTaskConfigType.WATCH_VIDEO_ON_MOBILE
		) {
			const maxFuture = 10,
				speed = 7,
				interval = 1;
			const enrolledAt = new Date(
				quest.userStatus?.enrolled_at as any,
			).getTime();
			let completed = false;
			let fn = async () => {
				while (true) {
					const maxAllowed =
						Math.floor((Date.now() - enrolledAt) / 1000) +
						maxFuture;
					const diff = maxAllowed - secondsDone;
					const timestamp = secondsDone + speed;
					if (diff >= speed) {
						const res = (await this.client.rest.post(
							`/quests/${quest.id}/video-progress`,
							{
								body: {
									timestamp: Math.min(
										secondsNeeded,
										timestamp + Math.random(),
									),
								},
							},
						)) as any;
						completed = res.completed_at != null;
						quest.updateUserStatus({
							...(quest.userStatus ?? {}),
							...res,
						} as any);
						secondsDone = Math.min(secondsNeeded, timestamp);
					}

					if (timestamp >= secondsNeeded) {
						break;
					}
					await this.timeout(interval * 1000);
				}
				if (!completed) {
					const res = (await this.client.rest.post(
						`/quests/${quest.id}/video-progress`,
						{
							body: { timestamp: secondsNeeded },
						},
					)) as any;
					quest.updateUserStatus({
						...(quest.userStatus ?? {}),
						...res,
					} as any);
				}
				console.log(`Quest "${questName}" completed!`);
			};
			console.log(`Spoofing video for ${questName}.`);
			await fn();
		} else if (taskName === QuestTaskConfigType.PLAY_ON_DESKTOP) {
			const interval = 60;
			while (!quest.isCompleted()) {
				const secondsDone = quest.userStatus?.progress?.[taskName]?.value as number || 0;
				const res = await this.client.rest.post(
					`/quests/${quest.id}/heartbeat`,
					{
						body: {
							application_id: quest.config.application.id,
							terminal: false,
						},
					},
				);
				quest.updateUserStatus(res as any);
				console.log(
					`Spoofed your game to ${applicationName}. Wait for ${Math.ceil(
						(secondsNeeded - secondsDone) / 60,
					)} more minutes.`,
				);
				await new Promise((resolve) =>
					setTimeout(resolve, interval * 1000),
				);
			}
			const res = await this.client.rest.post(
				`/quests/${quest.id}/heartbeat`,
				{
					body: {
						application_id: quest.config.application.id,
						terminal: true,
					},
				},
			);
			quest.updateUserStatus(res as any);
			console.log(`Quest "${questName}" completed!`);
		} else {
			throw new Error(
				`Quest type "${taskName}" is not supported here. Complete "${questName}" with the Discord desktop app.`,
			);
		}
	}
}
