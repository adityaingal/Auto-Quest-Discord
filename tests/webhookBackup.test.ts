import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '../bot/config';
import { Database } from '../bot/database';
import { Repositories } from '../bot/database/repositories';
import { AdminService } from '../bot/services/adminService';
import { WebhookBackupService } from '../bot/services/webhookBackupService';
import type { DiscordWebhook, WebhookFilePayload } from '../bot/integrations/webhook';

const ATTACHMENT = 'https://cdn.discordapp.com/attachments/1/2/snapshot.sqlite';
const WEBHOOK_URL = 'https://discord.com/api/webhooks/123/token';

class FakeWebhook {
	uploads = 0;
	fail = false;
	bytes: Buffer | null = null;

	private hash(): string {
		return createHash('sha256').update(this.bytes ?? Buffer.alloc(0)).digest('hex');
	}

	async sendFile(
		_target: unknown,
		payload: WebhookFilePayload,
	): Promise<unknown> {
		this.uploads++;
		if (this.fail) return null;

		this.bytes = Buffer.from(payload.bytes);
		return {
			messageId: 'msg-1',
			attachments: [
				{
					id: 'attachment-1',
					filename: payload.filename,
					size: this.bytes.length,
					url: ATTACHMENT,
				},
			],
		};
	}

	async getMessage(): Promise<unknown> {
		return {
			id: 'msg-1',
			embeds: [
				{
					fields: [
						{ name: 'SHA-256', value: `\`${this.hash()}\`` },
						{ name: 'Size (bytes)', value: String(this.bytes?.length ?? 0) },
					],
				},
			],
			attachments: [
				{ id: 'attachment-1', filename: 'snapshot.sqlite', size: this.bytes?.length ?? 0, url: ATTACHMENT },
			],
		};
	}

	async download(): Promise<Buffer | null> {
		return this.bytes;
	}
}

function harness(t: { after(fn: () => void): void }) {
	const dir = mkdtempSync(join(tmpdir(), 'quest-backup-'));

	const databasePath = join(dir, 'quest-bot.sqlite');
	const config = loadConfig({
		DISCORD_BOT_TOKEN: 'token',
		DISCORD_CLIENT_ID: '1',
		ENCRYPTION_KEY: 'a-secret-that-is-long-enough',
		DOTENV_PATH: '.env.does-not-exist',
		DATABASE_PATH: databasePath,
		WEBHOOK_URL,
		WEBHOOK_BACKUP_ENABLED: 'true',
	} as NodeJS.ProcessEnv);

	const database = new Database(databasePath);
	database.migrate();
	const repositories = new Repositories(database);
	const adminService = new AdminService(repositories, database, config);
	const webhook = new FakeWebhook();
	const service = new WebhookBackupService({
		config,
		database,
		repositories,
		adminService,
		webhook: webhook as unknown as DiscordWebhook,
	});

	// Close the SQLite handle before deleting its folder (Windows locks files).
	t.after(() => {
		database.close();
		rmSync(dir, { recursive: true, force: true });
	});
	return { config, database, repositories, adminService, webhook, service, databasePath };
}

test('a snapshot is uploaded once and identical data is not uploaded again', async (t) => {
	const h = harness(t);

	const first = await h.service.run();
	assert.equal(first.status, 'uploaded');
	assert.equal(h.webhook.uploads, 1);

	const state = h.repositories.getWebhookBackupState();
	assert.equal(state.hash?.length, 64);
	assert.equal(state.content_hash?.length, 64);
	assert.equal(state.message_id, 'msg-1');
	assert.equal(state.attachment_url, ATTACHMENT);
	assert.equal(state.last_success_at !== null, true);

	const second = await h.service.run();
	assert.equal(second.status, 'unchanged');
	assert.equal(h.webhook.uploads, 1, 'no second upload for identical data');
});

test('a failed upload never overwrites the last verified state', async (t) => {
	const h = harness(t);
	assert.equal((await h.service.run()).status, 'uploaded');
	const good = h.repositories.getWebhookBackupState();

	h.webhook.fail = true;
	// Force a real change so the backup is not skipped as unchanged.
	h.repositories.setConfig('probe', 'changed');
	assert.equal((await h.service.run()).status, 'failed');

	const after = h.repositories.getWebhookBackupState();
	assert.equal(after.hash, good.hash);
	assert.equal(after.message_id, good.message_id);
	assert.match(after.last_error ?? '', /confirm|upload/);
});

test('restore refuses a tampered snapshot', async (t) => {
	const h = harness(t);
	assert.equal((await h.service.run()).status, 'uploaded');

	h.webhook.bytes = Buffer.from('this is not the verified sqlite snapshot');
	await assert.rejects(
		() => h.service.restore('owner-1'),
		/match|hash|SQLite/i,
	);

	const row = h.repositories.getWebhookBackupState();
	assert.equal(row.message_id, 'msg-1');
});

test('restore refuses to roll back a newer local database', async (t) => {
	const h = harness(t);
	assert.equal((await h.service.run()).status, 'uploaded');

	h.repositories.saveWebhookBackupState({
		source_modified_at: new Date(Date.now() - 60_000).toISOString(),
	});
	const future = new Date(Date.now() + 60_000);
	utimesSync(h.databasePath, future, future);
	assert.ok(statSync(h.databasePath).mtimeMs > Date.now());

	await assert.rejects(
		() => h.service.restore('owner-1'),
		/newer than the webhook backup/,
	);
});

test('restore merges announcement history that is missing from the snapshot', async (t) => {
	const h = harness(t);
	assert.equal((await h.service.run()).status, 'uploaded');

	h.repositories.recordAnnouncementSeen('history-quest', 'pending');
	h.repositories.markAnnouncementAnnounced('history-quest', 'msg-9', 'chan-9');

	// Keep the rollback guard happy - this test intentionally writes after
	// the snapshot was taken.
	h.repositories.saveWebhookBackupState({
		source_modified_at: new Date(Date.now() + 60_000).toISOString(),
	});

	const result = await h.service.restore('owner-1');
	assert.ok(result.path.includes('pre-restore'));
	assert.equal(result.historyRows >= 1, true);

	const row = h.repositories.getAnnouncement('history-quest');
	assert.ok(row, 'permanent announcement history must survive a restore');
	assert.equal(row.message_id, 'msg-9');
	assert.equal(row.announcement_status, 'announced');
});
