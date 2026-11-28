import { randomUUID } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	copyFileSync,
	statSync,
	unlinkSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { Database } from '../database';
import {
	Repositories,
	type AnnouncementRow,
	type QuestMetadataRow,
} from '../database/repositories';
import { Config } from '../config';
import { Logger } from '../utils/logger';
import { NotFoundError, ValidationError } from '../utils/errors';
import { readRuntimeSettings, type RuntimeSettings } from './runtimeSettings';

export type BotStats = {
	users: number;
	links: number;
	quests: number;
	progressRows: number;
	historyRows: number;
	rewards: number;
	guilds: number;
	uptimeSeconds: number;
	memoryMb: number;
};

export class AdminService {
	constructor(
		private readonly repositories: Repositories,
		private readonly database: Database,
		private readonly config: Config,
	) {}

	private get backupDir(): string {
		return resolve(dirname(this.config.databasePath), 'backups');
	}

	/** Public read-only view used by the webhook backup service. */
	get backupDirectory(): string {
		return this.backupDir;
	}

	/**
	 * Removes stale WAL/SHM files before a restore. Without this, SQLite could
	 * replay transactions from the database that was just replaced.
	 */
	clearJournal(): void {
		for (const suffix of ['-wal', '-shm']) {
			const path = `${this.config.databasePath}${suffix}`;
			if (existsSync(path)) unlinkSync(path);
		}
	}

	stats(): BotStats {
		return {
			users: this.repositories.countUsers(),
			links: this.countLinks(),
			quests: this.repositories.listQuestRecords(1000).length,
			progressRows: this.countRows('quest_progress'),
			historyRows: this.repositories.countHistory(),
			rewards: this.countRows('reward_records'),
			guilds:
				this.database.get<{ count: number }>(
					'SELECT COUNT(*) AS count FROM guild_settings',
				)?.count ?? 0,
			uptimeSeconds: Math.round(process.uptime()),
			memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
		};
	}

	private countLinks(): number {
		return (
			this.database.get<{ count: number }>(
				'SELECT COUNT(*) AS count FROM account_links',
			)?.count ?? 0
		);
	}

	private countRows(table: string): number {
		return (
			this.database.get<{ count: number }>(
				`SELECT COUNT(*) AS count FROM ${table}`,
			)?.count ?? 0
		);
	}

	users(limit = 25) {
		return this.repositories.listUsers(limit);
	}

	logs(limit = 25) {
		return this.repositories.listAdminLogs(limit);
	}

	audit(actorId: string | null, action: string, detail: string | null): void {
		this.repositories.addAdminLog(actorId, action, detail);
	}

	backups(): string[] {
		if (!existsSync(this.backupDir)) return [];

		return readdirSync(this.backupDir)
			.filter((file) => file.endsWith('.sqlite'))
			.sort()
			.reverse();
	}

	/** Creates a consistent snapshot with a unique name (never clobbers one). */
	createSnapshot(prefix = 'quest-bot'): string {
		mkdirSync(this.backupDir, { recursive: true });
		const stamp = new Date()
			.toISOString()
			.replace(/[:.]/g, '-');
		const target = join(
			this.backupDir,
			`${prefix}-${stamp}-${randomUUID().slice(0, 8)}.sqlite`,
		);

		this.database.backup(target);
		Logger.info(`Database snapshot written to ${target}`);

		return target;
	}

	backup(): string {
		const target = this.createSnapshot('quest-bot');
		Logger.info(`Database backup written to ${target}`);
		return target;
	}

	restore(fileName: string): string {
		const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '');
		const source = join(this.backupDir, safeName);

		if (!existsSync(source)) {
			throw new NotFoundError(
				`No backup called \`${fileName}\` was found.`,
			);
		}

		// Announcement history is permanent: a restore may add rows, never
		// remove them. The same applies to the quest metadata history.
		const announcements = this.database.all<AnnouncementRow>(
			'SELECT * FROM quest_announcements',
		);
		const metadata = this.database.all<QuestMetadataRow>(
			'SELECT * FROM quest_metadata',
		);

		this.database.close();
		this.clearJournal();
		copyFileSync(source, this.config.databasePath);
		this.database.reopen();
		this.database.migrate();

		const kept = this.repositories.restoreAnnouncementHistory(announcements);
		const keptMetadata = this.repositories.restoreQuestMetadata(metadata);

		Logger.warn(`Database restored from ${source}`, {
			announcementsRestored: kept,
			metadataRestored: keptMetadata,
		});

		return source;
	}

	isMaintenance(): boolean {
		return this.repositories.getConfig('maintenance') === 'true';
	}

	setMaintenance(enabled: boolean): boolean {
		this.repositories.setConfig('maintenance', enabled ? 'true' : 'false');
		return enabled;
	}

	runtimeSettings(): RuntimeSettings {
		return readRuntimeSettings(this.repositories, this.config);
	}

	listConfig(): Record<string, string> {
		const settings = this.runtimeSettings();

		return {
			...this.repositories.allConfig(),
			maintenance: this.isMaintenance() ? 'true' : 'false',
			whitelist: this.isWhitelistEnabled() ? 'true' : 'false',
			// Effective values (environment defaults + owner overrides).
			quest_monitoring_enabled: String(settings.questMonitoringEnabled),
			quest_monitor_interval_minutes: String(
				settings.questMonitorIntervalMinutes,
			),
			public_quest_channel_id: settings.publicQuestChannelId ?? 'none',
			quest_images_enabled: String(settings.questImagesEnabled),
			quest_videos_enabled: String(settings.questVideosEnabled),
			quest_media_fallback: settings.questMediaFallback,
			membership_verification_enabled: String(
				settings.membershipVerificationEnabled,
			),
			required_guild_id: settings.requiredGuildId ?? 'none',
			required_guild_invite: settings.requiredGuildInvite ?? 'none',
			membership_verify_interval_minutes: String(
				settings.membershipVerifyIntervalMinutes,
			),
			membership_member_events: String(settings.membershipMemberEvents),
			webhook_backup_enabled: String(settings.webhookBackupEnabled),
			webhook_backup_interval_minutes: String(
				settings.webhookBackupIntervalMinutes,
			),
			webhook_backup_max_mb: String(
				Math.floor(settings.webhookBackupMaxBytes / (1024 * 1024)),
			),
			database_path: this.config.databasePath,
			database_backup_dir: this.backupDir,
			webhook_configured: this.config.webhookUrl ? 'true' : 'false',
		};
	}

	// ----------------------------------------------------------- whitelist

	isWhitelistEnabled(): boolean {
		return this.repositories.getConfig('whitelist') === 'true';
	}

	setWhitelistEnabled(enabled: boolean): boolean {
		this.repositories.setConfig('whitelist', enabled ? 'true' : 'false');
		return enabled;
	}

	/**
	 * A whitelisted user carries the "admin" role by default unless the
	 * administrator chose otherwise.
	 */
	isWhitelistedAdmin(userId: string): boolean {
		return this.repositories
			.listWhitelist('user')
			.some(
				(entry) => entry.entry_id === userId && entry.role === 'admin',
			);
	}

	whitelist(kind?: 'guild' | 'user') {
		return this.repositories.listWhitelist(kind);
	}

	addWhitelist(
		kind: 'guild' | 'user',
		entryId: string,
		label: string | null,
		actorId: string | null,
		role?: 'member' | 'admin',
	): void {
		this.repositories.addWhitelist({
			kind,
			entry_id: entryId,
			label,
			added_by: actorId,
			role,
		});
	}

	setWhitelistRole(
		kind: 'guild' | 'user',
		entryId: string,
		role: 'member' | 'admin',
	): void {
		this.repositories.setWhitelistRole(kind, entryId, role);
	}

	removeWhitelist(kind: 'guild' | 'user', entryId: string): boolean {
		return this.repositories.removeWhitelist(kind, entryId) > 0;
	}

	/**
	 * Decides whether an interaction may be answered. The owner and the
	 * admin role always pass. When the whitelist is off everything passes.
	 */
	checkAccess(input: {
		userId: string;
		guildId: string | null;
		isAdmin: boolean;
	}): { allowed: boolean; reason: string | null } {
		if (!this.isWhitelistEnabled()) {
			return { allowed: true, reason: null };
		}

		if (input.isAdmin) {
			return { allowed: true, reason: null };
		}

		if (
			input.guildId &&
			this.repositories.isWhitelisted('guild', input.guildId)
		) {
			return { allowed: true, reason: null };
		}

		if (
			this.repositories.isWhitelisted('user', input.userId)
		) {
			return { allowed: true, reason: null };
		}

		return {
			allowed: false,
			reason: input.guildId
				? 'This server is not on the whitelist.'
				: 'Your account is not on the whitelist.',
		};
	}

	setConfig(key: string, value: string): void {
		if (!/^[a-z0-9_.:-]+$/i.test(key)) {
			throw new ValidationError(
				'Config keys may only contain letters, numbers, dots, dashes and colons.',
			);
		}

		this.repositories.setConfig(key, value);
	}

	backupSize(path: string): number {
		try {
			return statSync(path).size;
		} catch {
			return 0;
		}
	}
}
