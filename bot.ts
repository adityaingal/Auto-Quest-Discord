import chalk from 'chalk';
import { loadAccounts } from './src/accounts';
import { BotController } from './src/botController';
import { QuestRunner, RunnerStatus, UserInfo } from './src/questRunner';

// Hosting platforms have no TTY, so the dashboard is replaced by log lines.
const PLAIN_OUTPUT =
	process.env.PLAIN_OUTPUT === '1' || !process.stdout.isTTY;

// Minutes between quest runs. 0 = run once and exit (good for cron/CI).
const LOOP_MINUTES = Number(process.env.LOOP_MINUTES ?? 0);

// Seconds waited between accounts so the gateway does not get hammered.
// Discord rate limits identify requests, so keep a small gap between them.
const ACCOUNT_STAGGER_SECONDS = Number(
	process.env.ACCOUNT_STAGGER_SECONDS ?? 8,
);

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	const accounts = loadAccounts();

	if (accounts.length === 0) {
		console.error(
			chalk.red('❌ No accounts configured.'),
			chalk.white(
				'Set TOKEN (single account), TOKENS (several) or add accounts.json.',
			),
		);
		process.exit(1);
	}

	// With several accounts the dashboard would fight over the screen.
	const plainOutput = PLAIN_OUTPUT || accounts.length > 1;

	console.log(
		chalk.cyan(
			`Starting Auto Quest for ${accounts.length} account(s): ${accounts
				.map((account) => account.name)
				.join(', ')}`,
		),
	);

	const runners = accounts.map(
		(account) =>
			new QuestRunner({
				account,
				plainOutput,
				label: accounts.length > 1 ? account.name : undefined,
			}),
	);

	const active: { runner: QuestRunner; user: UserInfo }[] = [];

	for (const runner of runners) {
		try {
			const user = await runner.start();
			active.push({ runner, user });

			console.log(
				chalk.green(
					`[${runner.account.name}] Signed in as ${user.username} (${user.id})`,
				),
			);

			await runner.notifier.send(
				`🟢 **Auto Quest online** - running for ${user.username} (\`${user.id}\`)`,
			);
		} catch (error) {
			const message = (error as Error).message;
			console.error(
				chalk.red(`[${runner.account.name}] ❌ ${message}`),
			);
			await runner.notifier.send(
				`🚨 **Account failed to start**: ${message}`,
			);
		}

		if (
			ACCOUNT_STAGGER_SECONDS > 0 &&
			runner !== runners[runners.length - 1]
		) {
			await sleep(ACCOUNT_STAGGER_SECONDS * 1000);
		}
	}

	if (active.length === 0) {
		console.error(chalk.red('❌ No account could be started.'));
		process.exit(1);
	}

	// The Discord bot drives the workers: it can trigger runs and show status.
	const botToken = process.env.BOT_TOKEN?.trim();
	const commandChannel = process.env.BOT_COMMAND_CHANNEL_ID?.trim();

	if (botToken && commandChannel) {
		const controller = new BotController({
			target: {
				list: (): RunnerStatus[] =>
					active.map(({ runner }) => runner.status),
				runAll: async () => {
					const started = await Promise.all(
						active.map(async ({ runner }) => runner.run()),
					);
					return started.filter(Boolean).length;
				},
				runOne: async (name: string) => {
					const entry = active.find(
						({ runner }) =>
							runner.account.name.toLowerCase() === name.toLowerCase(),
					);
					if (!entry) return false;

					return entry.runner.run();
				},
				stop: () => {
					console.log(chalk.gray('🛑 Stopped by the Discord bot.'));
					process.exit(0);
				},
			},
			token: botToken,
			channelId: commandChannel,
			adminUserIds: (process.env.BOT_ADMIN_USER_IDS ?? '').split(','),
			prefix: process.env.BOT_PREFIX ?? '!',
		});

		try {
			await controller.start();
		} catch (error) {
			console.error(
				chalk.red(
					`⚠ Bot controller failed to start: ${(error as Error).message}`,
				),
			);
		}
	} else if (botToken) {
		console.warn(
			chalk.yellow(
				'⚠ BOT_TOKEN is set but BOT_COMMAND_CHANNEL_ID is missing - the bot only posts notifications.',
			),
		);
	}

	for (;;) {
		await Promise.all(
			active.map(async ({ runner }) => {
				try {
					await runner.run();
				} catch (error) {
					console.error(
						chalk.red(
							`[${runner.account.name}] ❌ ${
								(error as Error).message
							}`,
						),
					);
				}
			}),
		);

		if (LOOP_MINUTES <= 0) break;

		console.log(
			chalk.gray(
				`⏳ Next run in ${LOOP_MINUTES} minute(s). Press Ctrl+C to stop.`,
			),
		);
		await sleep(LOOP_MINUTES * 60_000);
	}

	process.exit(0);
}

process.on('SIGINT', () => {
	console.log(chalk.gray('\n👋 Stopped.'));
	process.exit(0);
});

main().catch((error: unknown) => {
	console.error(chalk.red(`❌ ${(error as Error).message}`));
	process.exit(1);
});
