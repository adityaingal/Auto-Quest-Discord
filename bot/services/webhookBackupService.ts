import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
	statSync,
} from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Config } from '../config';
import { Database } from '../database';
import type {
	AnnouncementRow,
	QuestMetadataRow,
	Repositories,
} from '../database/repositories';
import {
	DiscordWebhook,
	parseWebhookUrl,
	verifiedAttachmentUrl,
} from '../integrations/webhook';
import { webhookBackupEmbed } from '../ui/embeds';
import { Logger } from '../utils/logger';
import { NotFoundError, ValidationError } from '../utils/errors';
import type { AdminService } from './adminService';
import type { RuntimeSettings } from './runtimeSettings';

export type WebhookBackupStatus =
	| 'uploaded'
	| 'unchanged'
	| 'skipped'
	| 'failed';

export type WebhookBackupResult = {
	status: WebhookBackupStatus;
	reason?: string;
	hash?: string;
	messageId?: string;
};

type Settings = Pick<
	RuntimeSettings,
	'webhookBackupEnabled' | 'webhookBackupIntervalMinutes' | 'webhookBackupMaxBytes'
>;

export type WebhookBackupServiceOptions = {
	config: Config;
	database: Database;
	repositories: Repositories;
	adminService: AdminService;
	/** Test seam - replaces network calls. */
	webhook?: DiscordWebhook;
	/** Test seam - resolves live owner overrides from bot_config. */
	getSettings?: () => Settings;
};

const SQLITE_HEADER = Buffer.from('SQLite format 3\0');

/**
 * Automatic database snapshots to the existing WEBHOOK_URL.
 *
 * This reuses the project's own `Database.backup()` / `AdminService` path and
 * a single verified Discord webhook. A `VACUUM INTO` snapshot contains every
 * table, so no separate backup store is needed. The SHA-256 of the snapshot
 * decides whether anything changed; identical content is never uploaded twice.
 */
export class WebhookBackupService {
	private running = false;
	private restoring = false;
	private timer: NodeJS.Timeout | null = null;

	constructor(private readonly options: WebhookBackupServiceOptions) {}

	private settings(): Settings {
		const base: Settings = {
			webhookBackupEnabled: this.options.config.webhookBackupEnabled,
			webhookBackupIntervalMinutes:
				this.options.config.webhookBackupIntervalMinutes,
			webhookBackupMaxBytes: this.options.config.webhookBackupMaxBytes,
		};

		return this.options.getSettings
			? { ...base, ...this.options.getSettings() }
			: base;
	}

	private get webhook(): DiscordWebhook {
		return this.options.webhook ?? new DiscordWebhook();
	}

	private target() {
		return this.options.config.webhookUrl
			? parseWebhookUrl(this.options.config.webhookUrl)
			: null;
	}

	/** Latest mtime of the database and its WAL, used as a rollback guard. */
	private sourceModifiedAt(): string {
		let time = 0;

		for (const path of [
			this.options.config.databasePath,
			`${this.options.config.databasePath}-wal`,
		]) {
			try {
				time = Math.max(time, statSync(path).mtimeMs);
			} catch {
				// file may not exist (in-memory database, fresh install)
			}
		}

		return new Date(time || Date.now()).toISOString();
	}

	private schemaVersion(): number {
		return (
			this.options.database.get<{ version: number }>(
				'SELECT MAX(version) AS version FROM schema_migrations',
			)?.version ?? 0
		);
	}

	/**
	 * Digest of the logical data. `webhook_backup_state` and `admin_logs`
	 * are excluded because both are written by the backup itself; including
	 * them would make every identical snapshot look changed and upload again.
	 */
	private contentHash(): string {
		const hash = createHash('sha256');
		const tables = this.options.database.all<{ name: string }>(
			`SELECT name FROM sqlite_master
			 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
			   AND name NOT IN ('webhook_backup_state', 'admin_logs')
			 ORDER BY name`,
		);

		for (const { name } of tables) {
			const safe = name.replace(/"/g, '""');
			hash.update(safe);
			const rows = this.options.database.all<Record<string, unknown>>(
				`SELECT * FROM "${safe}" ORDER BY rowid`,
			);
			hash.update(JSON.stringify(rows));
		}

		return hash.digest('hex');
	}

	/** Creates a snapshot, uploads it once, and records only verified state. */
	async run(): Promise<WebhookBackupResult> {
		const settings = this.settings();

		if (!settings.webhookBackupEnabled) {
			return { status: 'skipped', reason: 'disabled' };
		}

		const target = this.target();
		if (!target) {
			return { status: 'skipped', reason: 'webhook not configured' };
		}

		if (this.running) {
			return { status: 'skipped', reason: 'already running' };
		}

		this.running = true;
		let snapshot: string | null = null;
		const generatedAt = new Date().toISOString();

		try {
			const logicalHash = this.contentHash();
			const state = this.options.repositories.getWebhookBackupState();

			if (state.content_hash === logicalHash) {
				// Do not write anything: the state row is deliberately not
				// part of the logical hash, so an unchanged run is a no-op.
				return { status: 'unchanged', hash: state.hash ?? undefined };
			}

			snapshot = this.options.adminService.createSnapshot('webhook');
			const bytes = readFileSync(snapshot);
			const hash = createHash('sha256').update(bytes).digest('hex');

			if (bytes.length > settings.webhookBackupMaxBytes) {
				throw new ValidationError(
					`The database snapshot (${bytes.length} bytes) exceeds ` +
						`WEBHOOK_BACKUP_MAX_MB (${Math.floor(
							settings.webhookBackupMaxBytes / (1024 * 1024),
						)} MB).`,
				);
			}

			const result = await this.webhook.sendFile(target, {
				filename: `quest-bot-${generatedAt.replace(/[:.]/g, '-')}.sqlite`,
				bytes,
				content: 'Encrypted database snapshot - do not share.',
				embeds: [
					webhookBackupEmbed({
						hash,
						size: bytes.length,
						generatedAt,
						schemaVersion: this.schemaVersion(),
					}).toJSON(),
				],
			});

			if (!result || !result.attachments[0]) {
				throw new Error('the webhook did not confirm the upload');
			}

			this.options.repositories.saveWebhookBackupState({
				hash,
				content_hash: logicalHash,
				size: bytes.length,
				message_id: result.messageId,
				attachment_url: result.attachments[0].url,
				generated_at: generatedAt,
				source_modified_at: this.sourceModifiedAt(),
				last_attempt_at: generatedAt,
				last_success_at: generatedAt,
				last_error: null,
			});

			this.options.adminService.audit(
				null,
				'webhook_backup',
				`message ${result.messageId} (${hash.slice(0, 12)})`,
			);

			Logger.info('Webhook database backup uploaded.', {
				messageId: result.messageId,
				size: bytes.length,
				hash: hash.slice(0, 12),
			});

			return { status: 'uploaded', hash, messageId: result.messageId };
		} catch (error) {
			this.options.repositories.saveWebhookBackupState({
				last_attempt_at: generatedAt,
				last_error: (error as Error).message.slice(0, 500),
			});
			Logger.warn(
				`Webhook database backup failed: ${(error as Error).message}`,
			);
			return { status: 'failed', reason: (error as Error).message };
		} finally {
			this.running = false;
			if (snapshot && existsSync(snapshot)) {
				try {
					unlinkSync(snapshot);
				} catch {
					// leaving a temp file is harmless - never crash the timer
				}
			}
		}
	}

	/**
	 * Admin-controlled restore from the last verified webhook snapshot.
	 * Checks hash, SQLite integrity and rollback safety before touching the
	 * live database, then merges the permanent announcement history back in.
	 */
	async restore(actorId: string): Promise<{ path: string; historyRows: number }> {
		const target = this.target();
		if (!target) {
			throw new NotFoundError('No valid WEBHOOK_URL is configured.');
		}

		if (this.restoring) {
			throw new ValidationError('A webhook restore is already running.');
		}

		this.restoring = true;
		const state = this.options.repositories.getWebhookBackupState();

		if (!state.message_id || !state.hash) {
			this.restoring = false;
			throw new NotFoundError('No verified webhook backup is available.');
		}

		const directory = this.options.adminService.backupDirectory;
		mkdirSync(directory, { recursive: true });
		const temp = join(directory, `webhook-restore-${Date.now()}.sqlite`);

		try {
			const message = await this.webhook.getMessage(target, state.message_id);
			if (!message) {
				throw new NotFoundError(
					'The recorded webhook message could not be read.',
				);
			}

			const metaHash = this.embedValue(message.embeds, 'SHA-256');
			const metaSize = this.embedValue(message.embeds, 'Size (bytes)');

			if (metaHash && metaHash !== state.hash) {
				throw new ValidationError(
					'The webhook snapshot metadata does not match the stored hash.',
				);
			}

			const attachmentUrl = verifiedAttachmentUrl(
				message.attachments[0]?.url ?? state.attachment_url,
			);
			if (!attachmentUrl) {
				throw new ValidationError(
					'The recorded attachment is not on Discord\'s CDN.',
				);
			}

			const bytes = await this.webhook.download(
				attachmentUrl,
				this.settings().webhookBackupMaxBytes,
			);
			if (!bytes) {
				throw new ValidationError(
					'The snapshot could not be downloaded or is too large.',
				);
			}

			if (metaSize && Number(metaSize) !== bytes.length) {
				throw new ValidationError('The snapshot size does not match.');
			}

			if (
				bytes.subarray(0, SQLITE_HEADER.length).compare(SQLITE_HEADER) !== 0
			) {
				throw new ValidationError('The snapshot is not a SQLite database.');
			}

			const hash = createHash('sha256').update(bytes).digest('hex');
			if (hash !== state.hash) {
				throw new ValidationError(
					'The snapshot hash does not match the verified backup.',
				);
			}

			writeFileSync(temp, bytes);
			this.verifyIntegrity(temp);

			const baseline = Date.parse(
				state.source_modified_at ?? state.generated_at ?? '',
			);
			const current = Date.parse(this.sourceModifiedAt());

			if (
				Number.isFinite(baseline) &&
				Number.isFinite(current) &&
				current > baseline + 2_000
			) {
				throw new ValidationError(
					'The local database is newer than the webhook backup - refusing to roll it back.',
				);
			}

			const announcements = this.options.database.all<AnnouncementRow>(
				'SELECT * FROM quest_announcements',
			);
			const metadata = this.options.database.all<QuestMetadataRow>(
				'SELECT * FROM quest_metadata',
			);
			const safety = this.options.adminService.createSnapshot('pre-restore');

			this.options.database.close();
			this.options.adminService.clearJournal();
			writeFileSync(this.options.config.databasePath, bytes);
			this.options.database.reopen();
			this.options.database.migrate();

			const historyRows =
				this.options.repositories.restoreAnnouncementHistory(announcements) +
				this.options.repositories.restoreQuestMetadata(metadata);

			this.options.adminService.audit(
				actorId,
				'webhook_restore',
				`${safety} (${hash.slice(0, 12)})`,
			);

			Logger.warn('Database restored from a verified webhook snapshot.', {
				actorId,
				safety,
				historyRows,
			});

			return { path: safety, historyRows };
		} finally {
			this.restoring = false;
			if (existsSync(temp)) {
				try {
					unlinkSync(temp);
				} catch {
					// ignore
				}
			}
		}
	}

	private embedValue(
		embeds: unknown[],
		name: string,
	): string | null {
		for (const embed of embeds as {
			fields?: { name?: string; value?: string }[];
		}[]) {
			for (const field of embed.fields ?? []) {
				if (field.name === name) {
					return String(field.value ?? '').replace(/`/g, '');
				}
			}
		}
		return null;
	}

	private verifyIntegrity(path: string): void {
		const db = new DatabaseSync(path);
		try {
			const row = db
				.prepare('PRAGMA integrity_check')
				.get() as { integrity_check?: string };
			if (row?.integrity_check !== 'ok') {
				throw new ValidationError('The snapshot failed SQLite integrity_check.');
			}
		} finally {
			db.close();
		}
	}

	/** Starts one rescheduling timer; live interval changes apply on next tick. */
	start(intervalMinutes: number): void {
		if (this.timer) return;
		this.schedule(intervalMinutes);
		Logger.info(
			`Webhook database backup timer started (every ${
				this.settings().webhookBackupIntervalMinutes
			}m, webhook id only).`,
		);
	}

	private schedule(fallbackMinutes: number): void {
		const minutes =
			this.settings().webhookBackupIntervalMinutes || fallbackMinutes;

		this.timer = setTimeout(() => {
			void this.run().catch((error: unknown) => {
				Logger.warn(
					`Webhook backup timer failed: ${(error as Error).message}`,
				);
			});
			this.schedule(fallbackMinutes);
		}, Math.max(1, minutes) * 60_000);
	}

	stop(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}
}
