import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../bot/config';
import { Database } from '../bot/database';
import { Repositories } from '../bot/database/repositories';
import { readRuntimeSettings } from '../bot/services/runtimeSettings';

function harness(overrides: NodeJS.ProcessEnv = {}) {
	const db = new Database(':memory:');
	db.migrate();
	const repositories = new Repositories(db);
	const config = loadConfig({
		DISCORD_BOT_TOKEN: 'token',
		DISCORD_CLIENT_ID: '1',
		ENCRYPTION_KEY: 'a-secret-that-is-long-enough',
		DOTENV_PATH: '.env.does-not-exist',
		...overrides,
	} as NodeJS.ProcessEnv);

	return { db, repositories, config };
}

test('environment defaults are reflected in the effective settings', () => {
	const h = harness({
		QUEST_MONITOR_INTERVAL_MINUTES: '7',
		QUEST_IMAGES_ENABLED: 'false',
		QUEST_VIDEOS_ENABLED: 'false',
		QUEST_MEDIA_FALLBACK: 'omit',
		REQUIRED_GUILD_ID: 'guild-1',
		WEBHOOK_BACKUP_ENABLED: 'true',
		WEBHOOK_BACKUP_MAX_MB: '12',
	});

	const settings = readRuntimeSettings(h.repositories, h.config);
	assert.equal(settings.questMonitorIntervalMinutes, 7);
	assert.equal(settings.questImagesEnabled, false);
	assert.equal(settings.questVideosEnabled, false);
	assert.equal(settings.questMediaFallback, 'omit');
	assert.equal(settings.membershipVerificationEnabled, true);
	assert.equal(settings.requiredGuildId, 'guild-1');
	assert.equal(settings.webhookBackupEnabled, true);
	assert.equal(settings.webhookBackupMaxBytes, 12 * 1024 * 1024);
	h.db.close();
});

test('owner overrides win but cannot enable membership without a guild', () => {
	const h = harness({ REQUIRED_GUILD_ID: 'guild-1' });

	h.repositories.setConfig('quest_monitoring_enabled', 'off');
	h.repositories.setConfig('quest_monitor_interval_minutes', '42');
	h.repositories.setConfig('required_guild_id', 'none');
	h.repositories.setConfig('required_guild_invite', 'https://discord.gg/abc');
	h.repositories.setConfig('quest_media_fallback', 'omit');
	h.repositories.setConfig('webhook_backup_max_mb', '3');

	const settings = readRuntimeSettings(h.repositories, h.config);
	assert.equal(settings.questMonitoringEnabled, false);
	assert.equal(settings.questMonitorIntervalMinutes, 42);
	assert.equal(settings.requiredGuildId, null);
	assert.equal(settings.membershipVerificationEnabled, false);
	assert.equal(settings.requiredGuildInvite, 'https://discord.gg/abc');
	assert.equal(settings.questMediaFallback, 'omit');
	assert.equal(settings.webhookBackupMaxBytes, 3 * 1024 * 1024);
	h.db.close();
});

test('garbage values fall back instead of producing invalid intervals', () => {
	const h = harness();
	h.repositories.setConfig('quest_monitor_interval_minutes', 'soon');
	h.repositories.setConfig('membership_verify_interval_minutes', '0');
	h.repositories.setConfig('quest_images_enabled', '');

	const settings = readRuntimeSettings(h.repositories, h.config);
	assert.equal(settings.questMonitorIntervalMinutes, h.config.questMonitorIntervalMinutes);
	assert.equal(
		settings.membershipVerifyIntervalMinutes,
		h.config.membershipVerifyIntervalMinutes,
	);
	assert.equal(settings.questImagesEnabled, h.config.questImagesEnabled);
	h.db.close();
});
