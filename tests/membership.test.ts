import test from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from 'discord.js';

import { loadConfig } from '../bot/config';
import { Database } from '../bot/database';
import { Repositories } from '../bot/database/repositories';
import {
	MembershipService,
	type MembershipNotice,
} from '../bot/services/membershipService';

const BASE_ENV = {
	DISCORD_BOT_TOKEN: 'token',
	DISCORD_CLIENT_ID: '1',
	ENCRYPTION_KEY: 'a-secret-that-is-long-enough',
	DOTENV_PATH: '.env.does-not-exist',
} as NodeJS.ProcessEnv;

function apiError(status: number): Error & { status: number } {
	const error = new Error(`HTTP ${status}`) as Error & { status: number };
	error.status = status;
	return error;
}

function harness(options: {
	enabled?: boolean;
	fetchMember?: (guildId: string, userId: string) => Promise<{ joinedAt: string | null }>;
	notify?: (userId: string, payload: MembershipNotice) => Promise<void>;
} = {}) {
	const db = new Database(':memory:');
	db.migrate();
	const repositories = new Repositories(db);
	const config = loadConfig({
		...BASE_ENV,
		REQUIRED_GUILD_ID: options.enabled === false ? '' : 'guild-1',
		REQUIRED_GUILD_INVITE: 'https://discord.gg/abc',
	});

	const notices: string[] = [];
	const service = new MembershipService({
		repositories,
		config,
		client: {} as Client,
		fetchMember: options.fetchMember,
		notify:
			options.notify ??
			(async (userId) => {
				notices.push(userId);
			}),
	});

	return { db, repositories, config, service, notices };
}

test('verification is skipped when the feature is off', async () => {
	const h = harness({ enabled: false });
	assert.deepEqual(await h.service.verify('user-1'), {
		allowed: true,
		status: 'disabled',
	});
	h.db.close();
});

test('a successful REST lookup grants DM access and stores real membership', async () => {
	const h = harness({
		fetchMember: async () => ({ joinedAt: '2026-01-01T00:00:00.000Z' }),
	});

	assert.deepEqual(await h.service.verify('user-1'), {
		allowed: true,
		status: 'member',
	});
	const row = h.repositories.getMembership('user-1', 'guild-1')!;
	assert.equal(row.is_member, 1);
	assert.equal(row.joined_at, '2026-01-01T00:00:00.000Z');
	assert.equal(row.last_verified_at !== null, true);
	h.db.close();
});

test('a 404 is a real leave and the invite is sent only on the transition', async () => {
	const h = harness({
		fetchMember: async (_guildId, userId) => {
			if (userId === 'user-2') throw apiError(404);
			return { joinedAt: null };
		},
	});

	assert.equal((await h.service.verify('user-1')).status, 'member');

	// A previously verified member whose next live check returns 404.
	h.repositories.recordMembership({
		discord_user_id: 'user-2',
		guild_id: 'guild-1',
		is_member: true,
	});
	assert.deepEqual(await h.service.verify('user-2'), {
		allowed: false,
		status: 'not-member',
	});
	assert.equal(h.notices.length, 1);

	// Cached denial does not send another DM.
	await h.service.verify('user-2');
	assert.equal(h.notices.length, 1);
	assert.equal(
		h.repositories.getMembership('user-2', 'guild-1')!.is_member,
		0,
	);
	h.db.close();
});

test('403, 429 and timeouts deny without erasing a known membership', async () => {
	for (const failure of [apiError(403), apiError(429), new Error('timeout')]) {
		const h = harness({
			fetchMember: async () => {
				throw failure;
			},
		});

		// Establish a real membership in the database without priming the
		// short-lived positive cache, so the API path is actually exercised.
		h.repositories.recordMembership({
			discord_user_id: 'user-1',
			guild_id: 'guild-1',
			is_member: true,
		});

		const decision = await h.service.verify('user-1');
		assert.equal(decision.allowed, false);
		assert.equal(decision.status, 'unverified');
		assert.equal(
			h.repositories.getMembership('user-1', 'guild-1')!.is_member,
			1,
			'uncertain API errors must not be treated as a leave',
		);
		assert.match(
			h.repositories.getMembership('user-1', 'guild-1')!.last_error ?? '',
			/HTTP|timeout/,
		);
		h.db.close();
	}
});

test('gateway join/leave events and periodic reconciliation catch missed leaves', async () => {
	let member = true;
	const h = harness({
		fetchMember: async () => {
			if (!member) throw apiError(404);
			return { joinedAt: null };
		},
	});

	h.service.onMemberAdd('user-1');
	assert.equal(
		h.repositories.getMembership('user-1', 'guild-1')!.is_member,
		1,
	);

	member = false;
	const result = await h.service.reconcile();
	assert.deepEqual(result, { checked: 1, removed: 1 });
	assert.equal(h.notices.length, 1);

	// A closed DM is logged and never crashes an event handler.
	const closed = harness({
		fetchMember: async () => {
			throw apiError(404);
		},
		notify: async () => {
			throw new Error('DM closed');
		},
	});
	closed.service.onMemberAdd('user-2');
	await closed.service.onMemberRemove('user-2');
	assert.equal(
		closed.repositories.getMembership('user-2', 'guild-1')!.is_member,
		0,
	);
	closed.db.close();
	h.db.close();
});

test('denial only offers a verified Discord invite', () => {
	const h = harness();
	const payload = h.service.denial();
	const json = JSON.stringify(payload.components.map((row) => row.toJSON()));
	assert.ok(json.includes('https://discord.gg/abc'));
	assert.equal(payload.embeds.length, 1);
	h.db.close();
});
