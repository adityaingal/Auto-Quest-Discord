import { loadAccounts } from '../src/accounts';
import { ClientQuest } from '../src/client';

type Quest = {
	id: string;
	config: {
		messages: { quest_name: string };
		task_config?: { tasks?: Record<string, unknown> };
		task_config_v2?: { tasks?: Record<string, unknown> };
		rewards_config?: { rewards: { messages: { name: string } }[] };
	};
	user_status: {
		enrolled_at: string | null;
		completed_at: string | null;
		claimed_at: string | null;
	} | null;
};

(async () => {
	const accounts = loadAccounts();

	if (accounts.length === 0) {
		console.error(
			'❌ No accounts configured. Set TOKEN, TOKENS or add accounts.json.',
		);
		process.exitCode = 1;
		return;
	}

	for (const account of accounts) {
		const client = new ClientQuest(account.token);

		try {
			const response = (await client.rest.get('/quests/@me')) as {
				quests: Quest[];
			};

			console.log(`\n=== ${account.name} ===`);

			for (const quest of response.quests) {
				const status = quest.user_status;
				const tasks = Object.keys(
					quest.config.task_config?.tasks ??
						quest.config.task_config_v2?.tasks ??
						{},
				);

				console.log(
					[
						quest.id,
						quest.config.messages.quest_name.padEnd(34),
						`tasks=${tasks.join('|') || 'none'}`,
						`enrolled=${status?.enrolled_at ? 'y' : 'n'}`,
						`completed=${status?.completed_at ? 'y' : 'n'}`,
						`claimed=${status?.claimed_at ? 'y' : 'n'}`,
						`reward=${
							quest.config.rewards_config?.rewards?.[0]?.messages
								.name ?? '-'
						}`,
					].join('  '),
				);
			}
		} catch (error) {
			const status = (error as { status?: number })?.status;
			const message = (error as { message?: string })?.message ?? error;
			console.error(`❌ [${account.name}] ${status ?? ''} ${message}`);
		}
	}
})();
