import test from 'node:test';
import assert from 'node:assert/strict';
import { commands, commandNames } from '../bot/commands/registry';
import { Database } from '../bot/database';
import { Repositories } from '../bot/database/repositories';
import { CatalogProvider } from '../bot/integrations/catalogProvider';
import { QuestService } from '../bot/services/questService';
import { ProgressService } from '../bot/services/progressService';
import { AccountService } from '../bot/services/accountService';
import { RewardService } from '../bot/services/rewardService';
import { DiscordOAuth2 } from '../bot/integrations/oauth2';
import { TokenVault } from '../bot/utils/crypto';
import { NotFoundError, IntegrationUnavailableError } from '../bot/utils/errors';

const CATALOG = 'quest.json';

function services() {
	const db = new Database(':memory:');
	db.migrate();
	const repositories = new Repositories(db);
	const catalog = new CatalogProvider(CATALOG);
	const vault = new TokenVault(Buffer.alloc(32, 7));
	const oauth2 = new DiscordOAuth2({
		clientId: '1',
		clientSecret: 'secret',
		redirectUri: 'https://example.com/oauth/callback',
		scopes: ['identify'],
	});

	const accountService = new AccountService(repositories, oauth2, vault);
	const linked = {
		listFor: async () => {
			throw new IntegrationUnavailableError(
				'Live quest data',
				'test double',
			);
		},
		require: async () => {
			throw new IntegrationUnavailableError(
				'Live quest data',
				'test double',
			);
		},
		claim: async () => ({ claimed: false, message: 'n/a' }),
		rewardCode: async () => ({ code: 'ABC', platform: 0 }),
	};

	const questService = new QuestService(
		repositories,
		catalog,
		linked as never,
	);
	const progressService = new ProgressService(repositories);
	const rewardService = new RewardService(repositories, linked as never);

	return {
		db,
		repositories,
		catalog,
		questService,
		progressService,
		rewardService,
		accountService,
	};
}

test('all six command groups are registered', () => {
	assert.deepEqual(commandNames.sort(), [
		'account',
		'admin',
		'quest',
		'reward',
		'task',
		'token',
	]);
});

test('every command group exposes the documented subcommands', () => {
	const expected: Record<string, string[]> = {
		quest: [
			'list',
			'info',
			'start',
			'auto',
			'all',
			'sessions',
			'progress',
			'status',
			'refresh',
			'history',
		],
		account: ['link', 'status', 'unlink', 'privacy'],
		task: ['list', 'info', 'progress', 'verify'],
		reward: ['list', 'info', 'status', 'claim', 'code'],
		admin: [
			'setup',
			'stats',
			'users',
			'logs',
			'reload',
			'backup',
			'restore',
			'maintenance',
			'config',
		],
		token: ['list', 'add', 'import', 'remove', 'check'],
	};

	for (const command of commands) {
		const json = command.data.toJSON() as {
			options?: { name: string; type: number; options?: { name: string }[] }[];
		};
		const subcommands = (json.options ?? [])
			.filter((option) => option.type === 1)
			.map((option) => option.name);

		assert.deepEqual(
			subcommands.sort(),
			(expected[command.data.name] ?? []).sort(),
			`${command.data.name} subcommands`,
		);
	}
});

test('the catalogue provider lists quests from quest.json', async () => {
	const { catalog, db } = services();
	const quests = await catalog.list();

	assert.ok(quests.length > 10, 'expected quests in the catalogue');

	const first = quests[0];
	assert.ok(first.id);
	assert.ok(first.name);
	assert.ok(Array.isArray(first.tasks));
	assert.ok(Array.isArray(first.rewards));

	db.close();
});

test('the catalogue provider resolves a single quest', async () => {
	const { catalog, db } = services();
	const quests = await catalog.list();
	const detail = await catalog.get(quests[0].id, 'user-1');

	assert.ok(detail);
	assert.equal(detail.id, quests[0].id);
	db.close();
});

test('an unknown quest raises a not found error', async () => {
	const { catalog, db } = services();
	await assert.rejects(
		() => catalog.require('does-not-exist'),
		NotFoundError,
	);
	db.close();
});

test('a live provider that is unavailable is reported as such', async () => {
	const { db } = services();
	const linked = {
		listFor: async (_discordUserId: string) => {
			throw new IntegrationUnavailableError(
				'Live quest data',
				'test double',
			);
		},
	};

	await assert.rejects(
		() => linked.listFor('user-1'),
		IntegrationUnavailableError,
	);
	db.close();
});

test('the quest service falls back to the catalogue', async () => {
	const { questService, db } = services();
	const result = await questService.list('user-1');

	assert.ok(result.quests.length > 0);
	assert.equal(result.source, 'catalogue');
	assert.equal(result.live, false);
	db.close();
});

test('progress is recorded and the percentage is calculated', async () => {
	const { questService, progressService, db } = services();
	const { quests } = await questService.list('user-1');
	const quest = quests[0];

	quest.progress = {
		value: 450,
		target: 900,
		percent: 50,
		enrolledAt: null,
		completedAt: null,
		claimedAt: null,
	};

	questService.recordProgress('user-1', quest);
	const stored = progressService.get('user-1', quest.id);

	assert.ok(stored);
	assert.equal(stored.value, 450);
	assert.equal(stored.target, 900);
	assert.equal(ProgressService.percent(450, 900), 50);
	assert.equal(ProgressService.percent(10, 0), 0);
	assert.equal(ProgressService.percent(2000, 900), 100);
	db.close();
});

test('reward status reflects the quest state', async () => {
	const { questService, rewardService, db } = services();
	const { quests } = await questService.list('user-1');
	const status = rewardService.buildStatus(quests[0]);

	assert.equal(status.eligible, false);
	assert.ok(status.rewardTypeName);
	db.close();
});

test('tokens are encrypted at rest and can be decrypted again', () => {
	const vault = new TokenVault(Buffer.alloc(32, 3));
	const cipher = vault.encrypt('super-secret-token');

	assert.notEqual(cipher, 'super-secret-token');
	assert.ok(!cipher.includes('super-secret-token'));
	assert.equal(vault.decrypt(cipher), 'super-secret-token');
});

test('a wrong key cannot decrypt the payload', () => {
	const vault = new TokenVault(Buffer.alloc(32, 3));
	const cipher = vault.encrypt('super-secret-token');
	const other = new TokenVault(Buffer.alloc(32, 9));

	assert.throws(() => other.decrypt(cipher));
});

test('the account service stores a linked account', async () => {
	const { accountService, repositories, db } = services();

	const state = await accountService.beginLink('user-1');
	assert.ok(state.startsWith('https://discord.com/oauth2/authorize'));
	assert.ok(state.includes('state='));

	// Simulate the callback: the state is bound to the Discord user.
	const stored = repositories.consumeOauthState(
		new URL(state).searchParams.get('state') as string,
	);
	assert.equal(stored, 'user-1');

	repositories.linkAccount({
		discord_user_id: 'user-1',
		discord_account_id: 'account-9',
		discord_username: 'tester',
		access_token: 'encrypted-token',
		refresh_token: null,
		expires_at: new Date(Date.now() + 3600_000).toISOString(),
		scopes: 'identify',
	});

	const status = accountService.status('user-1');
	assert.equal(status.linked, true);
	assert.equal(status.discordUsername, 'tester');
	assert.equal(status.expired, false);

	assert.equal(accountService.unlink('user-1'), 1);
	assert.equal(accountService.status('user-1').linked, false);

	db.close();
});

test('the privacy notice explains the data that is stored', async () => {
	const { accountService, db } = services();
	const notice = accountService.privacyNotice().join('\n');

	assert.ok(notice.includes('encrypted'));
	assert.ok(notice.includes('Raw user tokens'));
	db.close();
});
