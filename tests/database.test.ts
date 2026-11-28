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
		'quest_announcements',
		'quest_metadata',
		'guild_membership',
		'webhook_backup_state',
	]) {
		assert.ok(tables.includes(table), `missing table ${table}`);
	}

	db.close();
});

test('migration v9 adds the announcement dedupe table on an existing install', () => {
	const db = createDatabase();
	db.migrate();

	// Simulate a database that stopped at migration v8: drop the tables
	// introduced by v9/v10 and forget that those migrations were applied.
	db.run('DROP TABLE quest_announcements');
	db.run('DROP TABLE quest_metadata');
	db.run('DROP TABLE guild_membership');
	db.run('DROP TABLE webhook_backup_state');
	db.run('DELETE FROM schema_migrations WHERE version IN (9, 10)');

	const applied = db.migrate();
	assert.deepEqual(applied, [9, 10]);

	const tables = db
		.all<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type = 'table'",
		)
		.map((row) => row.name);
	assert.ok(tables.includes('quest_announcements'));

	// Idempotent: a second run applies nothing.
	assert.deepEqual(db.migrate(), []);

	db.close();
});

test('migration v10 preserves existing announcement history', () => {
	const db = createDatabase();
	db.migrate();

	// Simulate a v9 install: remove v10 and its additive columns/tables.
	db.run('DROP INDEX IF EXISTS idx_quest_announcements_nonce');
	for (const column of [
		'announced_at',
		'reconcile_nonce',
		'attempts',
		'last_error',
	]) {
		db.run(`ALTER TABLE quest_announcements DROP COLUMN ${column}`);
	}
	db.run('DROP TABLE quest_metadata');
	db.run('DROP TABLE guild_membership');
	db.run('DROP TABLE webhook_backup_state');
	db.run('DELETE FROM schema_migrations WHERE version = 10');

	// A v9-era row must survive the upgrade byte for byte.
	db.run(
		`INSERT INTO quest_announcements
			(quest_id, first_discovered_at, last_detected_at,
			 announcement_status, message_id, channel_id, updated_at)
		 VALUES ('old-quest', '2026-01-01 00:00:00', '2026-01-02 00:00:00',
			 'announced', 'msg-9', 'channel-9', '2026-01-02 00:00:00')`,
	);

	assert.deepEqual(db.migrate(), [10]);

	const row = db.get<Record<string, unknown>>(
		'SELECT * FROM quest_announcements WHERE quest_id = ?',
		'old-quest',
	)!;
	assert.equal(row.first_discovered_at, '2026-01-01 00:00:00');
	assert.equal(row.last_detected_at, '2026-01-02 00:00:00');
	assert.equal(row.announcement_status, 'announced');
	assert.equal(row.message_id, 'msg-9');
	assert.equal(row.channel_id, 'channel-9');
	assert.equal(row.attempts, 0);

	const repositories = new Repositories(db);
	repositories.beginAnnouncementAttempt('old-quest', 'nonce-1');
	const after = repositories.getAnnouncement('old-quest')!;
	assert.equal(after.reconcile_nonce, 'nonce-1');
	assert.equal(after.attempts, 1);
	assert.equal(after.message_id, 'msg-9');

	assert.deepEqual(db.migrate(), []);
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
