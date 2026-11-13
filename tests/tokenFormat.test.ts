import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenService } from '../bot/services/tokenService';

test('user tokens are detected and refused', () => {
	// base64("1543822946328514683") - the legacy user token from the 1.0 selfbot
	const userToken =
		'MTU0MzgyMjk0NjMyODUxNDY4Mw.G4YkLq.-fkewLX6I3ZFvVBTfcSx2fJU70BonshKcXQMO0';

	assert.equal(TokenService.looksLikeUserToken(userToken), true);
	assert.equal(TokenService.looksLikeUserToken('short'), false);
});

test('bot tokens are not mistaken for user tokens', () => {
	// base64("123456789012345678") - the placeholder id every bot token uses
	const botToken =
		'MTIzNDU2Nzg5MDEyMzQ1Njc4.GxKrq.abcdefghijklmnopqrstuvwxyz012345';

	assert.equal(TokenService.looksLikeUserToken(botToken), false);
});

test('tokens are normalised before they are used', () => {
	assert.equal(
		TokenService.normalize('  MTIzNDU2Nzg5MDEyMzQ1Njc4.GxKrq.abc  '),
		'MTIzNDU2Nzg5MDEyMzQ1Njc4.GxKrq.abc',
	);
	assert.equal(
		TokenService.normalize('Bot MTIzNDU2Nzg5MDEyMzQ1Njc4.GxKrq.abc'),
		'MTIzNDU2Nzg5MDEyMzQ1Njc4.GxKrq.abc',
	);
	assert.equal(
		TokenService.normalize('"MTIzNDU2Nzg5MDEyMzQ1Njc4.GxKrq.abc"'),
		'MTIzNDU2Nzg5MDEyMzQ1Njc4.GxKrq.abc',
	);
});
