import { loadAccounts } from '../src/accounts';
import { ClientQuest } from '../src/client';

(async () => {
	const accounts = loadAccounts();

	if (accounts.length === 0) {
		console.error(
			'❌ No accounts configured. Set TOKEN, TOKENS or add accounts.json.',
		);
		process.exitCode = 1;
		return;
	}

	let failures = 0;

	for (const account of accounts) {
		const client = new ClientQuest(account.token);

		try {
			const user = (await client.rest.get('/users/@me')) as {
				id: string;
				username: string;
				global_name?: string;
			};

			console.log(
				`✅ [${account.name}] ${user.global_name ?? user.username} (${user.id})`,
			);
		} catch (error) {
			failures++;
			const status = (error as { status?: number })?.status;
			const message = (error as { message?: string })?.message ?? error;

			if (status === 401) {
				console.error(
					`❌ [${account.name}] Token rejected (401 Unauthorized). It is invalid or expired - copy a fresh one into the account list.`,
				);
			} else {
				console.error(`❌ [${account.name}] ${status ?? ''} ${message}`);
			}
		}
	}

	process.exitCode = failures > 0 ? 1 : 0;
})();
