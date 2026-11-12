import { Client } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { WebSocketManager } from '@discordjs/ws';
import {
	GatewayDispatchEvents,
	GatewayIntentBits,
} from 'discord-api-types/v10';
import chalk from 'chalk';
import { RunnerStatus } from './questRunner';

/**
 * A Discord bot cannot complete quests itself - quests are a user account
 * feature and the rewards belong to that user. What the bot *can* do is drive
 * the user-token workers: trigger a run, show their status and report results.
 */
export type ControllerTarget = {
	list(): RunnerStatus[];
	runAll(): Promise<number>;
	runOne(name: string): Promise<boolean>;
	stop(): void;
};

export type BotControllerOptions = {
	target: ControllerTarget;
	token: string;
	channelId?: string;
	adminUserIds?: string[];
	prefix?: string;
};

type MessageCreateData = {
	id: string;
	content: string;
	channel_id: string;
	author: { id: string; bot?: boolean; username: string };
};

export class BotController {
	private readonly target: ControllerTarget;
	private readonly rest: REST;
	private readonly channelId: string | null;
	private readonly adminUserIds: string[];
	private readonly prefix: string;
	private client: Client | null = null;

	constructor(options: BotControllerOptions) {
		this.target = options.target;
		this.rest = new REST({ version: '10' }).setToken(options.token);
		this.channelId = options.channelId?.trim() ?? null;
		this.adminUserIds = (options.adminUserIds ?? [])
			.map((id) => id.trim())
			.filter(Boolean);
		this.prefix = options.prefix ?? '!';
	}

	private isAdmin(userId: string): boolean {
		return this.adminUserIds.includes(userId);
	}

	private async reply(
		channelId: string,
		content: string,
	): Promise<void> {
		try {
			await this.rest.post(`/channels/${channelId}/messages`, {
				body: { content: content.slice(0, 2000) },
			});
		} catch (error) {
			console.error(
				chalk.red(
					`⚠ Bot could not reply: ${(error as Error).message}`,
				),
			);
		}
	}

	private formatStatus(): string {
		const accounts = this.target.list();

		if (accounts.length === 0) {
			return 'No accounts configured.';
		}

		return accounts
			.map((account) => {
				const state = account.connected
					? account.busy
						? '🟡 running'
						: '🟢 idle'
					: '🔴 offline';
				const last = account.lastRun
					? ` | last run ${account.lastRun.completed}/${account.lastRun.total}`
					: '';

				return `**${account.name}** (${account.username}) - ${state}${last}`;
			})
			.join('\n');
	}

	private formatQuests(): string {
		const accounts = this.target.list().filter(
			(account) => account.quests.length > 0,
		);

		if (accounts.length === 0) {
			return 'No quests in progress right now.';
		}

		return accounts
			.map((account) => {
				const quests = account.quests
					.map(
						(quest) =>
							`\`${quest.name}\` - ${quest.reward} - ${quest.status} (${Math.floor(
								quest.remaining / 60,
							)}m ${quest.remaining % 60}s left)`,
					)
					.join('\n');

				return `**${account.name}**\n${quests}`;
			})
			.join('\n\n');
	}

	private async handleCommand(
		message: MessageCreateData,
	): Promise<void> {
		const raw = message.content.trim();
		if (!raw.startsWith(this.prefix)) return;

		const [command = '', ...args] = raw
			.slice(this.prefix.length)
			.trim()
			.split(/\s+/);
		const argument = args.join(' ').trim().toLowerCase();

		const reply = (content: string) =>
			this.reply(message.channel_id, content);

		switch (command.toLowerCase()) {
			case 'help':
				await reply(
					[
						'**Auto Quest bot**',
						`\`${this.prefix}status\` - status tiap akun`,
						`\`${this.prefix}quests\` - quest yang sedang berjalan`,
						`\`${this.prefix}run [akun|all]\` - jalankan quest sekarang`,
						`\`${this.prefix}stop\` - matikan program`,
					].join('\n'),
				);
				return;

			case 'status':
				await reply(this.formatStatus());
				return;

			case 'quests':
				await reply(this.formatQuests());
				return;

			case 'run': {
				if (!this.isAdmin(message.author.id)) {
					await reply('❌ You are not allowed to run quests.');
					return;
				}

				if (argument && argument !== 'all') {
					const started = await this.target.runOne(argument);
					await reply(
						started
							? `▶️ Started a run for \`${argument}\`.`
							: `❌ Could not start \`${argument}\` (unknown account or already running).`,
					);
					return;
				}

				const count = await this.target.runAll();
				await reply(`▶️ Started a run for ${count} account(s).`);
				return;
			}

			case 'stop': {
				if (!this.isAdmin(message.author.id)) {
					await reply('❌ You are not allowed to stop the program.');
					return;
				}

				await reply('🛑 Stopping...');
				this.target.stop();
				return;
			}

			default:
				await reply(`Unknown command. Try \`${this.prefix}help\`.`);
		}
	}

	async start(): Promise<void> {
		const intents =
			GatewayIntentBits.Guilds |
			GatewayIntentBits.GuildMessages |
			GatewayIntentBits.MessageContent;

		const rest = new REST({ version: '10' }).setToken(
			process.env.BOT_TOKEN as string,
		);
		const gateway = new WebSocketManager({
			token: process.env.BOT_TOKEN as string,
			intents,
			rest,
		});

		const client = new Client({ rest, gateway });
		this.client = client;

		client.on(
			GatewayDispatchEvents.MessageCreate,
			(payload: {
				data?: MessageCreateData;
			}) => {
				const message = payload?.data;
				if (!message || message.author?.bot) return;
				if (this.channelId && message.channel_id !== this.channelId) {
					return;
				}

				this.handleCommand(message).catch((error: unknown) => {
					console.error(
						chalk.red(
							`⚠ Command failed: ${(error as Error).message}`,
						),
					);
				});
			},
		);

		await gateway.connect();

		console.log(
			chalk.cyan(
				`🤖 Bot controller online (commands: ${this.prefix}help${
					this.channelId ? ` in channel ${this.channelId}` : ''
				})`,
			),
		);
	}
}
