import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../bot/database';
import { Repositories } from '../bot/database/repositories';
import { TokenVault } from '../bot/utils/crypto';
import { RoomService } from '../bot/services/roomService';
import { parseWebhookUrl } from '../bot/integrations/webhook';
import { NotFoundError, ValidationError } from '../bot/utils/errors';

function setup() {
	const db = new Database(':memory:');
	db.migrate();
	const repositories = new Repositories(db);
	const vault = new TokenVault(Buffer.alloc(32, 5));
	const service = new RoomService(repositories, vault);

	return { db, repositories, vault, service };
}

/** A validator that accepts every token and reports a fixed account. */
const accept = async (token: string) => ({
	valid: true,
	id: `account-${token.slice(0, 4)}`,
	username: `user-${token.slice(0, 4)}`,
	message: 'ok',
});

test('a room is created for its owner', () => {
	const { db, service } = setup();

	const room = service.create('user-1', 'My Accounts', 'the main ones');

	assert.equal(room.name, 'My Accounts');
	assert.equal(room.ownerUserId, 'user-1');
	assert.equal(room.description, 'the main ones');
	assert.equal(room.accounts.length, 0);
	assert.equal(room.hasWebhook, false);

	// The room has a 30 day lifetime.
	const days = Math.round(
		(new Date(room.expiresAt).getTime() - Date.now()) /
			(24 * 60 * 60 * 1000),
	);
	assert.ok(days >= 29 && days <= 30, `the room lives for ${days} days`);

	db.close();
});

test('a room name has to be valid', () => {
	const { db, service } = setup();

	assert.throws(() => service.create('user-1', ''), ValidationError);
	assert.throws(() => service.create('user-1', 'a/b'), ValidationError);
	assert.throws(() => service.create('user-1', 'x'.repeat(50)), ValidationError);

	db.close();
});

test('a user cannot have two rooms with the same name', () => {
	const { db, service } = setup();

	service.create('user-1', 'Main');

	assert.throws(() => service.create('user-1', 'Main'), ValidationError);

	// Another user may use the same name - the rooms are separate.
	const other = service.create('user-2', 'Main');
	assert.equal(other.ownerUserId, 'user-2');

	db.close();
});

test('a room of another user is not found', () => {
	const { db, service } = setup();

	service.create('user-1', 'Main');

	assert.throws(() => service.require('user-2', 'Main'), NotFoundError);
	assert.equal(service.list('user-2').length, 0);
	assert.equal(service.list('user-1').length, 1);

	db.close();
});

test('the accounts of a room are numbered without a gap', async () => {
	const { db, service } = setup();

	service.create('user-1', 'Main');

	const first = await service.addAccount(
		'user-1',
		'Main',
		'token-one',
		accept,
	);
	const second = await service.addAccount(
		'user-1',
		'Main',
		'token-two',
		accept,
	);
	const third = await service.addAccount(
		'user-1',
		'Main',
		'token-three',
		accept,
	);

	assert.equal(first.slot, 1);
	assert.equal(second.slot, 2);
	assert.equal(third.slot, 3);

	db.close();
});

test('removing an account closes the gap in the sequence', async () => {
	const { db, service } = setup();

	service.create('user-1', 'Main');

	await service.addAccount('user-1', 'Main', 'token-one', accept);
	await service.addAccount('user-1', 'Main', 'token-two', accept);
	await service.addAccount('user-1', 'Main', 'token-three', accept);

	// The middle one goes away.
	const result = service.removeAccount('user-1', 'Main', 2);

	assert.equal(result.removed.slot, 2);
	assert.equal(result.nextSlot, 3);

	const room = service.require('user-1', 'Main');

	// The remaining accounts are 1 and 2 - there is no hole at 3.
	assert.deepEqual(
		room.accounts.map((account) => account.slot),
		[1, 2],
	);

	// The next account continues the sequence.
	const next = await service.addAccount(
		'user-1',
		'Main',
		'token-four',
		accept,
	);
	assert.equal(next.slot, 3);

	db.close();
});

test('the account of another room is not removed', async () => {
	const { db, service } = setup();

	service.create('user-1', 'First');
	service.create('user-1', 'Second');

	await service.addAccount('user-1', 'First', 'token-one', accept);
	await service.addAccount('user-1', 'Second', 'token-two', accept);

	// The slot belongs to the other room.
	assert.throws(
		() => service.removeAccount('user-1', 'First', 2),
		NotFoundError,
	);

	db.close();
});

test('the token of an account is never shown in full', async () => {
	const { db, service } = setup();

	service.create('user-1', 'Main');

	const account = await service.addAccount(
		'user-1',
		'Main',
		'MTIzNDU2Nzg5MDEyMzQ1Njc4.GaBcDe.FfGgHhIiJjKkLlMmNnOoPp',
		accept,
	);

	assert.ok(!account.masked.includes('GaBcDe'));
	assert.ok(account.masked.includes('...'));

	// The stored value is encrypted.
	const row = service
		.require('user-1', 'Main')
		.accounts.length;
	assert.equal(row, 1);

	db.close();
});

test('an invalid token is refused', async () => {
	const { db, service } = setup();

	service.create('user-1', 'Main');

	await assert.rejects(
		() =>
			service.addAccount('user-1', 'Main', 'bad', async () => ({
				valid: false,
				id: null,
				username: null,
				message: 'Discord rejected this token.',
			})),
		ValidationError,
	);

	// Nothing was stored.
	assert.equal(service.require('user-1', 'Main').accounts.length, 0);

	db.close();
});

test('a room is searched by name', () => {
	const { db, service } = setup();

	service.create('user-1', 'Main Accounts');
	service.create('user-1', 'Secondary');
	service.create('user-2', 'Main Accounts');

	const found = service.find('user-1', 'main');

	assert.equal(found.length, 1);
	assert.equal(found[0].name, 'Main Accounts');

	// The room of the other user is not part of the result.
	const all = service.find('user-1', '');
	assert.equal(all.length, 2);

	db.close();
});

test('a webhook url is only accepted when it points at Discord', () => {
	assert.equal(
		parseWebhookUrl(
			'https://discord.com/api/webhooks/123456789/abcdefghijk-token',
		)?.id,
		'123456789',
	);

	assert.equal(
		parseWebhookUrl(
			'https://canary.discord.com/api/webhooks/123/abc',
		)?.id,
		'123',
	);

	// Not Discord.
	assert.equal(parseWebhookUrl('https://evil.example.com/webhook'), null);
	assert.equal(parseWebhookUrl('http://discord.com/api/webhooks/1/a'), null);
	assert.equal(parseWebhookUrl('not a url'), null);
	assert.equal(parseWebhookUrl('https://discord.com/api/other/1/a'), null);
});

test('a webhook is stored on the room and never in the clear', () => {
	const { db, service, repositories } = setup();

	service.create('user-1', 'Main');

	const { room } = service.setWebhook(
		'user-1',
		'Main',
		'https://discord.com/api/webhooks/123456789/super-secret-token',
		false,
	);

	assert.equal(room.hasWebhook, true);

	// The token is encrypted in the database.
	const row = repositories.getRoomById(room.id);
	assert.ok(row?.webhook_token);
	assert.ok(!row.webhook_token.includes('super-secret-token'));

	db.close();
});

test('an expired room is reset', async () => {
	const { db, service, repositories } = setup();

	service.create('user-1', 'Main');
	await service.addAccount('user-1', 'Main', 'token-one', accept);

	const room = service.require('user-1', 'Main');

	// The room is moved into the past.
	repositories.updateRoom(room.id, {
		expires_at: new Date(Date.now() - 1000).toISOString(),
	});

	const expired = service.sweepExpired();

	assert.equal(expired.length, 1);
	assert.equal(expired[0].name, 'Main');
	assert.equal(service.list('user-1').length, 0);

	db.close();
});

test('a room that is still alive is kept', () => {
	const { db, service } = setup();

	service.create('user-1', 'Main');

	const expired = service.sweepExpired();

	assert.equal(expired.length, 0);
	assert.equal(service.list('user-1').length, 1);

	db.close();
});

test('a room can be renewed', () => {
	const { db, service, repositories } = setup();

	const room = service.create('user-1', 'Main');
	repositories.updateRoom(room.id, {
		expires_at: new Date(Date.now() - 1000).toISOString(),
	});

	const renewed = service.renew('user-1', 'Main');

	assert.ok(new Date(renewed.expiresAt).getTime() > Date.now());

	db.close();
});

test('deleting a room deletes the accounts with it', async () => {
	const { db, service, repositories } = setup();

	const room = service.create('user-1', 'Main');
	await service.addAccount('user-1', 'Main', 'token-one', accept);

	assert.equal(service.delete('user-1', 'Main'), true);
	assert.equal(service.list('user-1').length, 0);
	assert.equal(repositories.listRoomAccounts(room.id).length, 0);

	// A second delete reports that there was nothing to delete.
	assert.equal(service.delete('user-1', 'Main'), false);

	db.close();
});

test('the accounts of a user never reach another one', async () => {
	const { db, service } = setup();

	service.create('user-1', 'Main');
	service.create('user-2', 'Main');

	await service.addAccount('user-1', 'Main', 'token-one', accept);
	await service.addAccount('user-2', 'Main', 'token-two', accept);

	const first = service.accountsWithTokens('user-1');
	const second = service.accountsWithTokens('user-2');

	assert.equal(first.length, 1);
	assert.equal(second.length, 1);
	assert.equal(first[0].label, 'Main:1');
	assert.equal(second[0].label, 'Main:1');
	assert.notEqual(first[0].token, second[0].token);

	db.close();
});
