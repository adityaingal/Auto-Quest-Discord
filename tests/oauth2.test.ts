import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../bot/database';
import { Repositories } from '../bot/database/repositories';
import { DiscordOAuth2 } from '../bot/integrations/oauth2';

test('the authorize url carries the client id, scope and state', () => {
	const oauth = new DiscordOAuth2({
		clientId: '123',
		clientSecret: 'secret',
		redirectUri: 'http://localhost:3000/oauth/callback',
		scopes: ['identify'],
	});

	const url = new URL(oauth.buildAuthorizationUrl('state-1'));

	assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
	assert.equal(url.searchParams.get('client_id'), '123');
	assert.equal(url.searchParams.get('response_type'), 'code');
	assert.equal(url.searchParams.get('scope'), 'identify');
	assert.equal(url.searchParams.get('state'), 'state-1');
	assert.equal(
		url.searchParams.get('redirect_uri'),
		'http://localhost:3000/oauth/callback',
	);
});

test('every state value is unique', () => {
	const oauth = new DiscordOAuth2({
		clientId: '123',
		clientSecret: 'secret',
		redirectUri: 'http://localhost:3000/oauth/callback',
		scopes: ['identify'],
	});

	const states = new Set(
		Array.from({ length: 50 }, () => oauth.generateState()),
	);

	assert.equal(states.size, 50);
	for (const state of states) {
		assert.ok(state.length >= 32);
	}
});

test('a state survives a failed exchange so it can be retried', () => {
	const db = new Database(':memory:');
	db.migrate();
	const repositories = new Repositories(db);

	repositories.storeOauthState('state-1', 'user-1');

	// peek does not invalidate
	assert.equal(repositories.peekOauthState('state-1'), 'user-1');
	assert.equal(repositories.peekOauthState('state-1'), 'user-1');

	// consume does
	assert.equal(repositories.consumeOauthState('state-1'), 'user-1');
	assert.equal(repositories.peekOauthState('state-1'), undefined);
	assert.equal(repositories.consumeOauthState('state-1'), undefined);

	db.close();
});

test('the token exchange explains an invalid code', async () => {
	const oauth = new DiscordOAuth2({
		clientId: '123',
		clientSecret: 'secret',
		redirectUri: 'http://localhost:3000/oauth/callback',
		scopes: ['identify'],
	});

	// A bogus code makes Discord answer with invalid_grant / invalid_client.
	await assert.rejects(
		() => oauth.exchangeCode('definitely-not-valid'),
		(error: Error) => {
			assert.ok(error.message.length > 0);
			assert.ok(
				error.message.includes('/account link') ||
					error.message.includes('client credentials'),
				`unexpected message: ${error.message}`,
			);
			return true;
		},
	);
});
