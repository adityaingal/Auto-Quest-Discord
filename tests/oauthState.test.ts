import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenVault } from '../bot/utils/crypto';

test('a signed state verifies with the same key', () => {
	const vault = new TokenVault(Buffer.alloc(32, 1));
	const state = vault.sign({ userId: '123', issuedAt: Date.now() });

	const payload = vault.verify<{ userId: string }>(state);
	assert.equal(payload?.userId, '123');
});

test('a signed state does not verify with another key', () => {
	const vault = new TokenVault(Buffer.alloc(32, 1));
	const other = new TokenVault(Buffer.alloc(32, 2));
	const state = vault.sign({ userId: '123', issuedAt: Date.now() });

	assert.equal(other.verify(state), null);
});

test('a tampered state does not verify', () => {
	const vault = new TokenVault(Buffer.alloc(32, 1));
	const state = vault.sign({ userId: '123', issuedAt: Date.now() });
	const [body, signature] = state.split('.');

	const tampered = `${Buffer.from(
		JSON.stringify({ userId: '999', issuedAt: Date.now() }),
	).toString('base64url')}.${signature}`;

	assert.equal(vault.verify(tampered), null);
	assert.ok(body);
});

test('garbage states are rejected', () => {
	const vault = new TokenVault(Buffer.alloc(32, 1));

	assert.equal(vault.verify('nonsense'), null);
	assert.equal(vault.verify('a.b'), null);
});
