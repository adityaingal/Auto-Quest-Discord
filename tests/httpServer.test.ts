import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Database } from '../bot/database';
import { Repositories } from '../bot/database/repositories';
import { startHttpServer } from '../bot/httpServer';
import type { Services } from '../bot/services';

function fakeServices(): { services: Services; db: Database } {
	const db = new Database(':memory:');
	db.migrate();
	const repositories = new Repositories(db);

	const services = {
		repositories,
		adminService: {
			stats: () => ({
				users: 1,
				links: 0,
				quests: 2,
				progressRows: 0,
				historyRows: 0,
				rewards: 0,
				guilds: 1,
				uptimeSeconds: 42,
				memoryMb: 12,
			}),
		},
		accountService: {
			completeLink: async () => {
				throw new Error('invalid state');
			},
		},
	} as unknown as Services;

	return { services, db };
}

test('the health endpoint reports the bot status', async () => {
	const { services, db } = fakeServices();
	const server = startHttpServer(0, services);

	const port = (server.address() as AddressInfo).port;
	const response = await fetch(`http://127.0.0.1:${port}/health`);

	assert.equal(response.status, 200);

	const body = (await response.json()) as {
		status: string;
		uptime: number;
		users: number;
		quests: number;
	};

	assert.equal(body.status, 'ok');
	assert.equal(body.uptime, 42);
	assert.equal(body.users, 1);
	assert.equal(body.quests, 2);

	server.close();
	db.close();
});

test('unknown paths return a 404', async () => {
	const { services, db } = fakeServices();
	const server = startHttpServer(0, services);

	const port = (server.address() as AddressInfo).port;
	const response = await fetch(`http://127.0.0.1:${port}/nope`);

	assert.equal(response.status, 404);
	server.close();
	db.close();
});

test('the oauth callback rejects an incomplete request', async () => {
	const { services, db } = fakeServices();
	const server = startHttpServer(0, services);

	const port = (server.address() as AddressInfo).port;
	const response = await fetch(
		`http://127.0.0.1:${port}/oauth/callback?code=abc`,
	);

	assert.equal(response.status, 400);
	const html = await response.text();
	assert.ok(html.includes('Invalid request'));

	server.close();
	db.close();
});
