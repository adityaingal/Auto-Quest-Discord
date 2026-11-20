import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../bot/database';
import { Repositories } from '../bot/database/repositories';
import { TokenService } from '../bot/services/tokenService';
import { TokenVault } from '../bot/utils/crypto';

function createService() {
	const db = new Database(':memory:');
	db.migrate();
	const repositories = new Repositories(db);
	const vault = new TokenVault(Buffer.alloc(32, 11));

	return {
		db,
		repositories,
		service: new TokenService(repositories, vault),
		vault,
	};
}

test('tokens are masked and fingerprinted instead of shown', () => {
	const masked = TokenService.mask('MTIzNDU2Nzg5MDEyMzQ1Njc4.GxKrq.abcdefghijklmnop');
	assert.ok(masked.startsWith('MTIzND'));
	assert.ok(masked.endsWith('mnop'));
	assert.ok(!masked.includes('GxKrq'));

	const fingerprint = TokenService.fingerprint('abc');
	assert.equal(fingerprint.length, 8);
	assert.equal(fingerprint, TokenService.fingerprint('abc'));
	assert.notEqual(fingerprint, TokenService.fingerprint('abd'));
});

test('a bot token is validated against Discord', async () => {
	const { db, service } = createService();

	const result = await service.check('obviously-not-a-real-token');
	assert.equal(result.valid, false);
	assert.ok(result.message.length > 0);

	db.close();
});

test('an invalid token is rejected and never stored', async () => {
	const { db, service, repositories } = createService();

	await assert.rejects(
		() => service.add('broken', 'short'),
		/does not look like a Discord token/,
	);

	assert.equal(repositories.listBotTokens().length, 0);
	db.close();
});

test('a registered token is stored encrypted', async () => {
	const { db, repositories, service, vault } = createService();

	// Simulate a successful registration without touching the network.
	repositories.addBotToken({
		label: 'alt',
		token: vault.encrypt('MTIzNDU2Nzg5MDEyMzQ1Njc4.GxKrq.secretsecret'),
		type: 'bot',
		application_id: 'app-2',
		bot_user_id: 'bot-2',
		bot_username: 'alt-bot',
	});

	const rows = repositories.listBotTokens();
	assert.equal(rows.length, 1);
	assert.ok(!rows[0].token.includes('secretsecret'));

	const record = service.list()[0];
	assert.equal(record.label, 'alt');
	assert.equal(record.botUsername, 'alt-bot');
	assert.ok(record.masked.includes('...'));
	assert.equal(record.fingerprint.length, 8);

	db.close();
});

test('usable tokens can be resolved for the multi bot startup', () => {
	const { db, repositories, service, vault } = createService();

	repositories.addBotToken({
		label: 'alt',
		token: vault.encrypt('token-one'),
		type: 'bot',
		application_id: '1',
		bot_user_id: '2',
		bot_username: 'alt',
	});

	repositories.addBotToken({
		label: 'dead',
		token: vault.encrypt('token-two'),
		type: 'bot',
		application_id: '1',
		bot_user_id: '3',
		bot_username: 'dead',
	});
	repositories.touchBotToken(2, 'invalid');

	const usable = service.resolveUsable();
	assert.equal(usable.length, 1);
	assert.equal(usable[0].label, 'alt');
	assert.equal(usable[0].token, 'token-one');

	db.close();
});

test('a token can be removed', () => {
	const { db, repositories, service, vault } = createService();

	repositories.addBotToken({
		label: 'alt',
		token: vault.encrypt('token-one'),
		type: 'bot',
		application_id: '1',
		bot_user_id: '2',
		bot_username: 'alt',
	});

	assert.equal(service.remove(1), true);
	assert.equal(service.list().length, 0);
	assert.equal(service.remove(99), false);

	db.close();
});

test('tokens are private to the user who added them', () => {
	const { db, repositories, service, vault } = createService();

	repositories.addBotToken({
		label: 'main',
		token: vault.encrypt('alice-token'),
		type: 'user',
		application_id: null,
		bot_user_id: null,
		bot_username: null,
		account_id: 'alice-account',
		account_username: 'alice',
		owner_user_id: 'alice',
	});
	repositories.addBotToken({
		label: 'main',
		token: vault.encrypt('bob-token'),
		type: 'user',
		application_id: null,
		bot_user_id: null,
		bot_username: null,
		account_id: 'bob-account',
		account_username: 'bob',
		owner_user_id: 'bob',
	});
	repositories.addBotToken({
		label: 'legacy',
		token: vault.encrypt('legacy-token'),
		type: 'user',
		application_id: null,
		bot_user_id: null,
		bot_username: null,
		account_id: 'legacy-account',
		account_username: 'legacy',
	});

	assert.equal(repositories.listBotTokens().length, 3);
	assert.equal(service.list('alice').length, 1);
	assert.equal(service.list('bob').length, 1);
	assert.equal(service.list(null).length, 1);
	assert.equal(service.findByLabel('main', 'alice').accountUsername, 'alice');
	assert.equal(service.findByLabel('main', 'bob').accountUsername, 'bob');
	assert.deepEqual(
		service.resolveUserSessions('alice').map((entry) => entry.token),
		['alice-token'],
	);
	assert.deepEqual(
		service.resolveUserSessions('bob').map((entry) => entry.token),
		['bob-token'],
	);
	assert.deepEqual(
		service.resolveUserSessions('alice', true).map((entry) => entry.label),
		['main', 'legacy'],
	);
	assert.equal(service.remove(1, 'bob'), false);
	assert.equal(service.remove(1, 'alice'), true);

	db.close();
});

test('purging a user removes their tokens but keeps legacy tokens', () => {
	const { db, repositories, service, vault } = createService();

	repositories.addBotToken({
		label: 'mine',
		token: vault.encrypt('mine'),
		type: 'user',
		application_id: null,
		bot_user_id: null,
		bot_username: null,
		owner_user_id: 'alice',
	});
	repositories.addBotToken({
		label: 'legacy',
		token: vault.encrypt('legacy'),
		type: 'user',
		application_id: null,
		bot_user_id: null,
		bot_username: null,
	});

	repositories.purgeUser('alice');

	assert.equal(service.list('alice').length, 0);
	assert.equal(service.list(null).length, 1);
	assert.equal(service.list().length, 1);

	db.close();
});

test('/token add is available to every user', async () => {
	const { tokenCommand } = await import('../bot/commands/token');
	assert.equal(tokenCommand.data.toJSON().default_member_permissions, undefined);
});
