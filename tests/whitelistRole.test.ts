import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../bot/database';
import { Repositories } from '../bot/database/repositories';
import { AdminService } from '../bot/services/adminService';
import type { Config } from '../bot/config';

function createAdmin() {
	const db = new Database(':memory:');
	db.migrate();
	const repositories = new Repositories(db);

	const config = {
		databasePath: ':memory:',
		ownerIds: ['111'],
		adminRoleId: null,
	} as Config;

	const admin = new AdminService(repositories, db, config);

	return { db, repositories, admin };
}

test('a whitelisted member can be promoted to admin and back', () => {
	const { db, admin } = createAdmin();

	admin.addWhitelist('user', '222', 'Friend', '111', 'member');
	assert.equal(admin.isWhitelistedAdmin('222'), false);

	admin.setWhitelistRole('user', '222', 'admin');
	assert.equal(admin.isWhitelistedAdmin('222'), true);

	const entries = admin.whitelist('user');
	assert.equal(entries[0].role, 'admin');

	admin.setWhitelistRole('user', '222', 'member');
	assert.equal(admin.isWhitelistedAdmin('222'), false);

	db.close();
});

test('an admin whitelist entry grants admin access', () => {
	const { db, admin } = createAdmin();

	admin.addWhitelist('user', '333', 'Boss', '111', 'admin');
	assert.equal(admin.isWhitelistedAdmin('333'), true);
	assert.equal(admin.isWhitelistedAdmin('404'), false);

	db.close();
});

test('guild entries keep their role but do not grant admin', () => {
	const { db, admin } = createAdmin();

	admin.addWhitelist('guild', '999', 'My Server', '111', 'admin');
	assert.equal(admin.isWhitelistedAdmin('999'), false);

	db.close();
});
