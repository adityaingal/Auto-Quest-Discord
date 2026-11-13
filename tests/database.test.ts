import test from 'node:test';
import assert from 'node:assert/strict';
import { Database, MIGRATIONS } from '../bot/database';
import { Repositories } from '../bot/database/repositories';

function createDatabase(): Database {
	return new Database(':memory:');
}

test('migrations create the expected schema', () => {
	const db = createDatabase();
	const applied = db.migrate();

	assert.deepEqual(applied, MIGRATIONS.map((m) => m.version));

	const tables = db
		.all<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type = 'table'",
		)
		.map((row) => row.name);

	for (const table of [
		'users',
		'account_links',
		'quest_records',
		'quest_progress',
		'quest_history',
		'reward_records',
		'notification_settings',
		'guild_settings',
		'admin_logs',
		'bot_config',
		'oauth_states',
	]) {
		assert.ok(tables.includes(table), `missing table ${table}`);
	}

	db.close();
});

test('migrations are idempotent', () => {
	const db = createDatabase();
	db.migrate();
	const second = db.migrate();

	assert.deepEqual(second, []);
	db.close();
});

test('progress rows are upserted instead of duplicated', () => {
	const db = createDatabase();
	db.migrate();
	const repositories = new Repositories(db);

	repositories.saveProgress({
		discord_user_id: 'user-1',
		quest_id: 'quest-1',
		status: 'in-progress',
		value: 100,
		target: 900,
		percent: 11,
		enrolled_at: null,
		completed_at: null,
		claimed_at: null,
	});

	repositories.saveProgress({
		discord_user_id: 'user-1',
		quest_id: 'quest-1',
		status: 'completed',
		value: 900,
		target: 900,
		percent: 100,
		enrolled_at: null,
		completed_at: '2026-01-01T00:00:00Z',
		claimed_at: null,
	});

	const rows = repositories.listProgress('user-1');
	assert.equal(rows.length, 1);
	assert.equal(rows[0].status, 'completed');
	assert.equal(rows[0].percent, 100);

	db.close();
});

test('oauth states are single use', () => {
	const db = createDatabase();
	db.migrate();
	const repositories = new Repositories(db);

	repositories.storeOauthState('state-1', 'user-1');
	assert.equal(repositories.consumeOauthState('state-1'), 'user-1');
	assert.equal(repositories.consumeOauthState('state-1'), undefined);

	db.close();
});

test('history and admin logs are appended', () => {
	const db = createDatabase();
	db.migrate();
	const repositories = new Repositories(db);

	repositories.addHistory('user-1', 'quest-1', 'tracked', '10/900s');
	repositories.addAdminLog('admin-1', 'backup', '/tmp/backup.sqlite');

	assert.equal(repositories.listHistory('user-1').length, 1);
	assert.equal(repositories.listAdminLogs().length, 1);
	assert.ok(repositories.countHistory() >= 1);

	db.close();
});

test('transactions roll back on error', () => {
	const db = createDatabase();
	db.migrate();
	const repositories = new Repositories(db);

	assert.throws(() => {
		repositories.transaction(() => {
			repositories.addHistory('user-1', null, 'broken', null);
			throw new Error('boom');
		});
	}, /boom/);

	assert.equal(repositories.listHistory('user-1').length, 0);
	db.close();
});
