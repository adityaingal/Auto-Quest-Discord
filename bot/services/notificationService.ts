import { EmbedBuilder, Client } from 'discord.js';
import { Repositories } from '../database/repositories';
import { QuestService } from './questService';
import { ProgressService } from './progressService';
import { QuestEligibility } from '../models/enums';
import { Logger } from '../utils/logger';
import { COLORS, EMOJI } from '../ui/theme';
import { AccountScope } from './scope';
import { RoomService } from './roomService';

export type NotificationEvent =
	| 'new-quest'
	| 'progress'
	| 'completed'
	| 'reward'
	| 'auth';

/**
 * Watches the quest state of linked accounts and pushes notifications to
 * Discord. Polling is rate limit friendly: every user has its own interval
 * and the default is 15 minutes.
 *
 * The check runs in the scope of the user, so only their own accounts are
 * read - the accounts of the operator are never used as a fallback.
 */
export class NotificationService {
	private timer: NodeJS.Timeout | null = null;
	private readonly lastCheck = new Map<string, number>();
	private lastSweep = 0;

	constructor(
		private readonly client: Client,
		private readonly repositories: Repositories,
		private readonly questService: QuestService,
		private readonly progressService: ProgressService,
		private readonly scopeFor: (userId: string) => AccountScope,
		private readonly roomService?: RoomService,
	) {}


	start(intervalMinutes: number): void {
		if (this.timer) return;

		const interval = Math.max(1, intervalMinutes) * 60_000;
		this.timer = setInterval(() => {
			this.tick().catch((error: unknown) => {
				Logger.error(`Notification tick failed: ${(error as Error).message}`);
			});
		}, interval);

		Logger.info(`Notification scheduler started (every ${intervalMinutes}m)`);
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	async tick(): Promise<void> {
		// The rooms are reset automatically after 30 days. The sweep runs on
		// every tick, but it only does work when a room is actually due.
		await this.sweepRooms();

		const settings = this.repositories.listNotificationUsers();

		for (const entry of settings) {
			const last = this.lastCheck.get(entry.discord_user_id) ?? 0;
			const due =
				Date.now() - last >= entry.interval_minutes * 60_000;

			if (!due) continue;
			this.lastCheck.set(entry.discord_user_id, Date.now());

			try {
				await this.checkUser(entry.discord_user_id, {
					newQuests: entry.new_quests === 1,
					progress: entry.progress === 1,
					completion: entry.completion === 1,
					rewards: entry.rewards === 1,
					expiry: entry.expiry === 1,
				});
			} catch (error) {
				Logger.warn(
					`Notification check failed for ${entry.discord_user_id}: ${
						(error as Error).message
					}`,
				);
			}
		}
	}

	/**
	 * Resets the rooms that reached their 30 day limit and tells their
	 * owners about it.
	 */
	private async sweepRooms(): Promise<void> {
		if (!this.roomService) return;

		// The sweep runs at most once an hour, no matter how often the
		// notification tick runs.
		const now = Date.now();
		if (now - this.lastSweep < 60 * 60_000) return;
		this.lastSweep = now;

		try {
			await this.roomService.runExpirySweep(async (userId, message) => {
				const user = await this.client.users.fetch(userId);
				await user.send(message);
			});
		} catch (error) {
			Logger.warn(
				`The room sweep failed: ${(error as Error).message}`,
			);
		}
	}

	async checkUser(
		discordUserId: string,
		preferences: {
			newQuests: boolean;
			progress: boolean;
			completion: boolean;
			rewards: boolean;
			expiry: boolean;
		},
	): Promise<void> {
		const scope = this.scopeFor(discordUserId);
		const { quests } = await this.questService.list(scope);
		const known = new Set(
			this.repositories
				.listProgress(discordUserId)
				.map((row) => row.quest_id),
		);

		for (const quest of quests) {
			const stored = this.repositories.getProgress(
				discordUserId,
				quest.id,
			);

			if (!stored && preferences.newQuests) {
				await this.send(
					discordUserId,
					new EmbedBuilder()
						.setColor(COLORS.primary)
						.setTitle('NEW QUEST AVAILABLE')
						.setDescription(
							`**${quest.name}**\n${quest.applicationName ?? ''}`,
						)
						.setTimestamp(),
				);
				this.repositories.addHistory(
					discordUserId,
					quest.id,
					'new_quest',
					quest.name,
				);
				continue;
			}

			if (!stored) continue;

			const becameComplete =
				stored.status !== QuestEligibility.COMPLETED &&
				quest.eligibility === QuestEligibility.COMPLETED;

			if (becameComplete && preferences.completion) {
				await this.send(
					discordUserId,
					new EmbedBuilder()
						.setColor(COLORS.success)
						.setTitle(`${EMOJI.completed} QUEST COMPLETED`)
						.setDescription(
							`**${quest.name}**\nReward: ${
								quest.rewards[0]?.name ?? 'unknown'
							}`,
						)
						.setTimestamp(),
				);
				this.repositories.addHistory(
					discordUserId,
					quest.id,
					'completed',
					quest.name,
				);
				continue;
			}

			const valueChanged = quest.progress
				? stored.value !== quest.progress.value
				: false;

			if (valueChanged && preferences.progress) {
				await this.send(
					discordUserId,
					new EmbedBuilder()
						.setColor(COLORS.info)
						.setTitle('PROGRESS UPDATE')
						.setDescription(
							`**${quest.name}** - ${quest.progress?.value}s / ${quest.progress?.target}s (${quest.progress?.percent}%)`,
						)
						.setTimestamp(),
				);
			}

			const claimChanged =
				stored.claimed_at !== (quest.progress?.claimedAt ?? null);

			if (claimChanged && preferences.rewards) {
				await this.send(
					discordUserId,
					new EmbedBuilder()
						.setColor(COLORS.warning)
						.setTitle('REWARD UPDATE')
						.setDescription(
							claimChanged
								? `**${quest.name}** - the reward was claimed.`
								: `**${quest.name}** - the reward is ready to be claimed.`,
						)
						.setTimestamp(),
				);
			}

			this.progressService.record(discordUserId, quest);
			known.add(quest.id);
		}
	}

	private async send(
		discordUserId: string,
		embed: EmbedBuilder,
	): Promise<void> {
		try {
			const user = await this.client.users.fetch(discordUserId);
			await user.send({ embeds: [embed] });
		} catch (error) {
			Logger.warn(
				`Could not deliver a notification to ${discordUserId}: ${
					(error as Error).message
				}`,
			);
		}
	}
}
