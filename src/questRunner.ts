import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { WebSocketShardEvents } from '@discordjs/ws';
import chalk from 'chalk';
import Table from 'cli-table3';
import figlet from 'figlet';
import { Account } from './accounts';
import { ClientQuest } from './client';
import { Notifier } from './notifier';
import { Quest } from './quest';
import { QuestManager } from './questManager';

export type UserInfo = {
	username: string;
	id: string;
};

type ActiveQuest = {
	id: string;
	name: string;
	reward: string;
	remaining: number;
	status: 'Running' | 'Done';
};

const QUEST_DB: Record<string, { name: string; duration: number }> = {
	'1432436088508780675': { name: 'R.E.P.O. Monster', duration: 900 },
	'1436125144404725770': { name: 'Download Comet Browser', duration: 900 },
	'1439764528715010058': { name: 'New Season Ahsarah', duration: 900 },
	'1440059727005614090': { name: 'Opera GX', duration: 42 },
	'1418350811687419914': { name: 'The Power of Nitro', duration: 24 },
	'1425677992721514516': { name: 'Battlefield 6 Launch', duration: 900 },
	'1432424574561026070': { name: 'Dance with a Demon', duration: 900 },
	'1435391191834165398': { name: 'ABI Red Drops Fest', duration: 900 },
	'1437518140476100638': { name: 'Marvel Rivals S5.0', duration: 900 },
	'1431027486506094623': { name: 'Amazon Luna', duration: 29 },
	'1428083229587669155': { name: 'Bloons TD 6 Dart Monkey', duration: 900 },
	'1428459919212019874': { name: 'Crimson Desert', duration: 29 },
	'1435016951251603496': { name: 'Courtroom Chaos', duration: 75 },
	'1421275302923079721': { name: 'Space Marine 2 Free Demo', duration: 900 },
	'1435012985872715946': { name: 'Anno 117', duration: 158 },
	'1432205768106705070': { name: 'Battlefield REDSEC', duration: 900 },
	'1435367355759726642': { name: 'King of Meat Sale', duration: 29 },
	'1436481141711442101': { name: 'Where Winds Meet Launch', duration: 900 },
	'1430279721777762495': { name: 'PvZ Replanted', duration: 900 },
	'1432798014786764871': { name: 'Honkai: Star Rail', duration: 900 },
	'1410358070831480904': { name: 'Mobile Orbs Intro', duration: 31 },
	'1428139680477614150': { name: 'ARC Raiders', duration: 91 },
	'1432410015721062480': { name: 'ARC Raiders', duration: 900 },
	'1427820398283722833': { name: 'Painkiller', duration: 99 },
	'1427811805065121875': {
		name: 'Battlefield 6 on PS5 Video',
		duration: 29,
	},
	'1435777559475257428': { name: 'Amazon', duration: 29 },
	'1422714633357103315': { name: 'Monopoly at McD\u2019s', duration: 96 },
	'1435324548827451605': { name: 'GO Wild Area 2025', duration: 29 },
	'1437537235133005914': {
		name: 'Call of Duty: Black Ops 7',
		duration: 900,
	},
	'1438202046804136028': {
		name: 'Microsoft Edge - Your AI Browser',
		duration: 29,
	},
	'1428092429030129755': {
		name: 'Chainsaw Man \u2013 The Movie: Reze Arc',
		duration: 61,
	},
	'1434969640194539610': { name: 'Dinkum on Switch', duration: 89 },
	'1438642430571315290': {
		name: 'Alloyed Collective Gupdoption',
		duration: 900,
	},
	'1433219183411462265': { name: 'Palworld Collab', duration: 900 },
	'1435003145339273317': { name: 'The Running Man', duration: 148 },
	'1433542422268350574': { name: 'Firefox', duration: 19 },
	'1430258734113755247': { name: 'Jurassic World Rebirth', duration: 29 },
	'1432770475590684784': { name: 'Fortnite Discord', duration: 900 },
	'1438303745166409840': { name: 'EVE Online Video', duration: 89 },
	'1425291943302398073': { name: 'Discord Halloween 2025', duration: 22 },
	'1427829905323724922': { name: 'Bugonia', duration: 114 },
};

function formatTime(seconds: number): string {
	if (seconds <= 0) return chalk.bold.green('\u2714 DONE');

	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainingSeconds = seconds % 60;

	return `${hours > 0 ? `${hours}h ` : ''}${minutes}m ${remainingSeconds}s`;
}

function describeApiError(error: unknown): string {
	const status = (error as { status?: number })?.status;
	const message = (error as { message?: string })?.message ?? String(error);

	if (status === 401) {
		return 'Discord rejected the token (401 Unauthorized). The token is invalid or expired - copy a fresh one into TOKEN in .env.';
	}
	if (status === 403) {
		return 'Discord blocked the request (403 Forbidden). The token was accepted but the request was denied.';
	}

	return message;
}

export type RunnerStatus = {
	name: string;
	username: string;
	connected: boolean;
	busy: boolean;
	quests: {
		name: string;
		reward: string;
		remaining: number;
		status: string;
	}[];
	lastRun: { at: string; completed: number; total: number } | null;
};

export type QuestRunnerOptions = {
	account: Account;
	plainOutput: boolean;
	label?: string;
};

/**
 * Runs the quest cycle for a single Discord account.
 */
export class QuestRunner {
	public readonly account: Account;
	public readonly client: ClientQuest;
	public readonly notifier: Notifier;

	private readonly plainOutput: boolean;
	private readonly label: string;
	private activeQuests: ActiveQuest[] = [];
	private fatalError: Error | null = null;
	private rejectStart: ((error: Error) => void) | null = null;
	private user: UserInfo | null = null;
	private busy = false;
	private lastRun: RunnerStatus['lastRun'] = null;

	constructor(options: QuestRunnerOptions) {
		this.account = options.account;
		this.plainOutput = options.plainOutput;
		this.label = options.label ?? options.account.name;
		this.client = new ClientQuest(options.account.token);
		this.notifier = new Notifier({
			channelId: options.account.channelId,
			botToken: options.account.botToken,
			label: options.label,
		});

		// Without this listener an API error becomes an unhandled "error" event
		// and kills the process with a raw stack trace.
		const errorEmitter = this.client as unknown as {
			on(event: string, listener: (error: Error) => void): void;
		};
		errorEmitter.on('error', (error: Error) => {
			const status = (error as { status?: number })?.status;
			if (status === 401 || status === 403) {
				this.fail(new Error(describeApiError(error)));
			}
		});

		this.client.websocketManager.on(
			WebSocketShardEvents.Closed,
			({ code }) => {
				if (code === 4004) {
					this.fail(
						new Error('Invalid token (gateway closed with 4004).'),
					);
				}
			},
		);

		this.client.websocketManager.on(
			WebSocketShardEvents.Error,
			({ error }) => {
				console.error(
					chalk.red(`[${this.label}] ❌ Gateway error: ${error.message}`),
				);
			},
		);
	}

	private fail(error: Error): void {
		this.fatalError = error;
		this.rejectStart?.(error);
	}

	get hasFatalError(): boolean {
		return this.fatalError !== null;
	}

	get status(): RunnerStatus {
		return {
			name: this.account.name,
			username: this.user?.username ?? 'Unknown',
			connected: this.user !== null,
			busy: this.busy,
			quests: this.activeQuests.map((quest) => ({
				name: quest.name,
				reward: quest.reward,
				remaining: quest.remaining,
				status: quest.status,
			})),
			lastRun: this.lastRun,
		};
	}

	/**
	 * Runs a cycle, unless one is already running.
	 */
	async run(): Promise<boolean> {
		if (this.busy || !this.user) return false;

		this.busy = true;
		try {
			await this.runCycle(this.user);
			return true;
		} finally {
			this.busy = false;
		}
	}

	/**
	 * Connects to the gateway and resolves once the account is ready.
	 */
	async start(timeoutMs = 30_000, attempts = 2): Promise<UserInfo> {
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= attempts; attempt++) {
			try {
				return await this.connect(timeoutMs);
			} catch (error) {
				lastError = error as Error;

				if (attempt < attempts) {
					await new Promise((resolve) =>
						setTimeout(resolve, 10_000),
					);
				}
			}
		}

		throw lastError ?? new Error('Could not connect to the gateway.');
	}

	private connect(timeoutMs: number): Promise<UserInfo> {
		return new Promise<UserInfo>((resolve, reject) => {
			this.rejectStart = reject;

			const timer = setTimeout(() => {
				reject(
					new Error(
						'Gateway did not send READY in time (another session may already use this token).',
					),
				);
			}, timeoutMs);

			this.client.once(
				GatewayDispatchEvents.Ready,
				(payload: {
					data?: { user?: UserInfo };
					user?: UserInfo;
				}) => {
					clearTimeout(timer);
					// @discordjs/core wraps gateway payloads as { api, shardId, data }.
					this.user =
						payload?.data?.user ??
						payload?.user ?? {
							username: 'Unknown',
							id: 'Unknown',
						};
					resolve(this.user);
				},
			);

			this.client.connect().catch((error: unknown) => {
				clearTimeout(timer);
				reject(error as Error);
			});
		});
	}

	private log(message: string): void {
		console.log(`[${this.label}] ${message}`);
	}

	private getQuestData(quest: Quest): {
		name: string;
		duration: number;
		remaining: number;
		reward: string;
	} {
		const questId = quest.id || quest.config?.id || 'unknown';
		let name = questId;
		let duration = QUEST_DB[questId]?.duration ?? 900;
		let reward = 'Unknown';

		if (QUEST_DB[questId]) {
			name = QUEST_DB[questId].name;
		} else if (quest.config?.messages?.quest_name) {
			name = quest.config.messages.quest_name.trim();
		} else {
			name = questId.toString().replace(/_/g, ' ').replace(/-/g, ' ');
		}

		const taskTarget = quest.taskTarget;
		if (taskTarget > 0) {
			duration = taskTarget;
		}

		const rewards = quest.config?.rewards_config?.rewards;
		if (rewards && rewards.length > 0) {
			if (rewards[0].messages?.name) {
				reward = rewards[0].messages.name;
			} else if (rewards[0].orb_quantity) {
				reward = `${rewards[0].orb_quantity} Orbs`;
			}
		}

		const progress = Math.min(quest.progress, duration);

		return {
			name,
			duration,
			remaining: Math.max(0, duration - progress),
			reward,
		};
	}

	private renderScreen(user: UserInfo): void {
		if (this.plainOutput) {
			const summary = this.activeQuests
				.map(
					(quest) =>
						`${quest.name} [${quest.status}] ${formatTime(quest.remaining)}`,
				)
				.join(' | ');
			this.log(chalk.gray(`[status] ${summary || 'no active quests'}`));
			return;
		}

		console.clear();
		console.log(
			chalk.cyan(
				figlet.textSync('Auto Quest lfathh', {
					font: 'Slant',
				}),
			),
		);
		console.log(chalk.bold.green('\n\u2705  SYSTEM RUNNING...'));

		const userTable = new Table({
			head: [chalk.white('User Account'), chalk.white('User ID')],
			colWidths: [30, 25],
			style: {
				border: ['white'],
				'padding-left': 1,
				'padding-right': 1,
			},
		});
		userTable.push([chalk.yellow(user.username), chalk.cyan(user.id)]);
		console.log(userTable.toString());

		const questTable = new Table({
			head: [
				chalk.white('No'),
				chalk.white('Quest Name'),
				chalk.white('Reward'),
				chalk.white('Time Left'),
				chalk.white('Status'),
			],
			colWidths: [6, 35, 20, 15, 15],
			colAligns: ['center', 'left', 'center', 'center', 'center'],
			style: {
				border: ['white'],
			},
		});

		this.activeQuests.forEach((quest, index) => {
			let timerColor = chalk.yellow;
			if (quest.remaining < 60 && quest.remaining > 0) {
				timerColor = chalk.red;
			}

			questTable.push([
				index + 1,
				chalk.cyan(quest.name),
				chalk.magenta(quest.reward),
				timerColor(formatTime(quest.remaining)),
				quest.status === 'Running'
					? chalk.blue('\u25b6 Running')
					: chalk.green('\u2714 Done'),
			]);
		});

		console.log(chalk.bold.white('\n\u{1F4CB}  LIVE PROGRESS'));
		console.log(questTable.toString());
		console.log(chalk.gray('\n>> Press Ctrl+C to stop.'));
	}

	private async claimRewards(
		manager: QuestManager,
		quests: Quest[],
	): Promise<Map<string, string>> {
		const results = new Map<string, string>();

		for (const quest of quests) {
			const questName =
				quest.config?.messages?.quest_name?.trim() || quest.id;

			try {
				const response = await manager.claimReward(quest);
				const errors = response?.errors ?? [];

				if (errors.length > 0) {
					const message = errors
						.map((error) => error.message)
						.join('; ');
					results.set(quest.id, `FAILED: ${message}`);
					this.log(
						chalk.red(
							`⚠ Could not claim reward for "${questName}": ${message}`,
						),
					);
					await this.notifier.send(
						`⚠️ **Reward not claimed** for \`${questName}\`: ${message}`,
					);
				} else {
					results.set(quest.id, 'CLAIMED');
					this.log(
						chalk.green(`🎁 Claimed reward for "${questName}".`),
					);
					await this.notifier.send(
						`🎁 **Reward claimed** for \`${questName}\`.`,
					);
				}
			} catch (error) {
				const message =
					(error as { message?: string })?.message ?? 'Unknown error';
				results.set(quest.id, `FAILED: ${message}`);
				this.log(
					chalk.red(
						`⚠ Could not claim reward for "${questName}": ${message}`,
					),
				);
				await this.notifier.send(
					`⚠️ **Reward not claimed** for \`${questName}\`: ${message}`,
				);
			}
		}

		return results;
	}

	async runCycle(user: UserInfo): Promise<void> {
		this.log(chalk.cyan('Fetching quests...'));

		try {
			await this.client.fetchQuests();
		} catch (error) {
			const status = (error as { status?: number })?.status;
			if (status !== 401 && status !== 403) {
				this.log(
					chalk.red(
						`❌ Could not fetch quests: ${describeApiError(error)}`,
					),
				);
			}
			throw error;
		}

		const manager = this.client.questManager;
		if (!manager) {
			this.log(chalk.red('❌ Could not load quests.'));
			return;
		}

		// Rewards of quests that were completed but not claimed in an earlier run.
		await this.claimRewards(manager, manager.getClaimable());

		const validQuests = manager.filterQuestsValid();

		if (validQuests.length === 0) {
			this.log(chalk.red('\u274c No valid quests found.'));
			await this.notifier.send(
				'😴 Nothing to do right now - no valid quests.',
			);
			return;
		}

		this.activeQuests = validQuests.map((quest) => {
			const details = this.getQuestData(quest);
			return {
				id: quest.id,
				name: details.name,
				reward: details.reward,
				remaining: details.remaining,
				status: 'Running',
			};
		});

		let tick = 0;
		const intervalId = setInterval(() => {
			this.activeQuests.forEach((quest) => {
				if (quest.remaining > 0) quest.remaining--;
				else quest.status = 'Done';
			});

			tick++;
			// Plain output (hosting logs): one line per minute, not per second.
			if (this.plainOutput && tick % 60 !== 0) return;
			this.renderScreen(user);
		}, 1000);

		const results = await Promise.allSettled(
			validQuests.map((quest) => manager.doingQuest(quest)),
		);

		clearInterval(intervalId);

		const completedQuests = validQuests.filter((quest) =>
			quest.isCompleted(),
		);
		const claimResults = await this.claimRewards(manager, completedQuests);

		const reportTable = new Table({
			head: ['Quest', 'Result', 'Reward', 'Details'],
			style: { border: ['white'] },
		});

		for (const [index, result] of results.entries()) {
			const quest = validQuests[index];
			const currentQuest = this.activeQuests[index];
			if (!currentQuest || !quest) continue;

			if (result.status === 'fulfilled') {
				currentQuest.status = 'Done';
				const rewardValue =
					(result as PromiseFulfilledResult<unknown>).value ??
					currentQuest.reward ??
					'Completed';
				const claimStatus = claimResults.get(quest.id) ?? 'NOT CLAIMED';
				reportTable.push([
					currentQuest.name,
					chalk.green('SUCCESS'),
					chalk.yellow(String(rewardValue)),
					claimStatus === 'CLAIMED'
						? chalk.green(claimStatus)
						: chalk.red(claimStatus),
				]);

				this.log(
					chalk.green(
						`✅ Quest "${currentQuest.name}" completed - reward: ${String(rewardValue)} (${claimStatus})`,
					),
				);

				await this.notifier.send(
					`✅ **Quest completed**: \`${currentQuest.name}\`\nReward: **${rewardValue}** - ${claimStatus}`,
				);
			} else {
				const reasonMessage =
					(result.reason as { message?: string })?.message ||
					'Unknown Error';
				reportTable.push([
					currentQuest.name,
					chalk.red('FAILED'),
					chalk.gray('-'),
					chalk.red(reasonMessage.substring(0, 60)),
				]);

				this.log(
					chalk.red(
						`❌ Quest "${currentQuest.name}" failed - ${reasonMessage}`,
					),
				);

				await this.notifier.send(
					`❌ **Quest failed**: \`${currentQuest.name}\`\n${reasonMessage}`,
				);
			}
		}

		this.renderScreen(user);

		if (!this.plainOutput) {
			console.log(chalk.bold.white('\n\u2705  FINAL EXECUTION REPORT'));
			console.log(reportTable.toString());
		}
		this.log(chalk.green('\u2728 All tasks finished.'));

		const completed = results.filter(
			(result) => result.status === 'fulfilled',
		).length;

		this.lastRun = {
			at: new Date().toISOString(),
			completed,
			total: results.length,
		};

		await this.notifier.send(
			`🏁 Cycle finished - **${completed}/${results.length}** quests completed.`,
		);
	}
}
