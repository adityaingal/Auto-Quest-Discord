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
		ownerId: '111',
		adminRoleId: null,
	} as Config;

	const admin = new AdminService(repositories, db, config);

	return { db, repositories, admin };
}

test('the whitelist is off by default', () => {
	const { db, admin } = createAdmin();

	assert.equal(admin.isWhitelistEnabled(), false);
	assert.equal(
		admin.checkAccess({
			userId: '999',
			guildId: '222',
			isAdmin: false,
		}).allowed,
		true,
	);

	db.close();
});

test('entries can be added, listed and removed', () => {
	const { db, admin } = createAdmin();

	admin.addWhitelist('guild', '222', 'My Server', '111');
	admin.addWhitelist('user', '333', 'Friend', '111');

	assert.equal(admin.whitelist().length, 2);
	assert.equal(admin.whitelist('guild').length, 1);
	assert.equal(
		admin.removeWhitelist('guild', '222'),
		true,
	);
	assert.equal(admin.removeWhitelist('guild', '222'), false);

	db.close();
});

test('an active whitelist blocks unknown servers and users', () => {
	const { db, admin } = createAdmin();

	admin.addWhitelist('guild', '222', 'My Server', '111');
	admin.addWhitelist('user', '333', 'Friend', '111');
	admin.setWhitelistEnabled(true);

	const blocked = admin.checkAccess({
		userId: '999',
		guildId: '404',
		isAdmin: false,
	});
	assert.equal(blocked.allowed, false);
	assert.ok(blocked.reason?.includes('not on the whitelist'));

	const allowed = admin.checkAccess({
		userId: '999',
		guildId: '222',
		isAdmin: false,
	});
	assert.equal(allowed.allowed, true);

	const allowedUser = admin.checkAccess({
		userId: '333',
		guildId: '404',
		isAdmin: false,
	});
	assert.equal(allowedUser.allowed, true);

	db.close();
});

test('admins and the owner always pass the whitelist', () => {
	const { db, admin } = createAdmin();
	admin.setWhitelistEnabled(true);

	assert.equal(
		admin.checkAccess({
			userId: '999',
			guildId: '404',
			isAdmin: true,
		}).allowed,
		true,
	);

	db.close();
});

test('a disabled whitelist lets everybody through', () => {
	const { db, admin } = createAdmin();

	admin.addWhitelist('guild', '222', 'My Server', '111');
	admin.setWhitelistEnabled(true);
	admin.setWhitelistEnabled(false);

	assert.equal(
		admin.checkAccess({
			userId: '999',
			guildId: '404',
			isAdmin: false,
		}).allowed,
		true,
	);

	db.close();
});
