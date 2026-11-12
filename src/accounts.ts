import { existsSync, readFileSync } from 'node:fs';

export type Account = {
	name: string;
	token: string;
	channelId?: string;
	botToken?: string;
};

/**
 * Accounts are loaded from (in order of priority):
 *   1. a JSON file (ACCOUNTS_FILE, default "accounts.json")
 *   2. the TOKENS env var (comma/space/semicolon separated)
 *   3. the TOKEN env var (single account, kept for backwards compatibility)
 */
export function loadAccounts(): Account[] {
	const accounts: Account[] = [];

	const file = process.env.ACCOUNTS_FILE?.trim() || 'accounts.json';
	if (existsSync(file)) {
		try {
			// Strip the BOM some editors (and Windows PowerShell) add.
			const content = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
			const parsed = JSON.parse(content) as {
				accounts?: Partial<Account>[];
			} | Partial<Account>[];

			const list = Array.isArray(parsed) ? parsed : (parsed.accounts ?? []);

			list.forEach((entry, index) => {
				const token = String(entry.token ?? '').trim();
				if (!token) return;

				accounts.push({
					name: String(entry.name ?? `account-${index + 1}`),
					token,
					channelId: entry.channelId
						? String(entry.channelId).trim()
						: undefined,
					botToken: entry.botToken
						? String(entry.botToken).trim()
						: undefined,
				});
			});
		} catch (error) {
			console.error(
				`❌ Could not read ${file}: ${(error as Error).message}`,
			);
		}
	}

	const tokens = (process.env.TOKENS ?? '')
		.split(/[\s,;]+/)
		.map((token) => token.trim())
		.filter(Boolean);

	tokens.forEach((token) => {
		if (accounts.some((account) => account.token === token)) return;
		accounts.push({ name: `account-${accounts.length + 1}`, token });
	});

	const single = process.env.TOKEN?.trim();
	if (single && !accounts.some((account) => account.token === single)) {
		accounts.push({ name: 'account-1', token: single });
	}

	return accounts;
}
