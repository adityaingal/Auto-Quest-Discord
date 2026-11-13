import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { Database } from '../database';
import { Repositories } from '../database/repositories';
import { Config } from '../config';
import { Logger } from '../utils/logger';
import { NotFoundError, ValidationError } from '../utils/errors';

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

	backup(): string {
		mkdirSync(this.backupDir, { recursive: true });
		const stamp = new Date()
			.toISOString()
			.replace(/[:.]/g, '-');
		const target = join(this.backupDir, `quest-bot-${stamp}.sqlite`);

		this.database.backup(target);
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

		this.database.close();
		copyFileSync(source, this.config.databasePath);
		this.database.reopen();

		Logger.warn(`Database restored from ${source}`);

		return source;
	}

	isMaintenance(): boolean {
		return this.repositories.getConfig('maintenance') === 'true';
	}

	setMaintenance(enabled: boolean): boolean {
		this.repositories.setConfig('maintenance', enabled ? 'true' : 'false');
		return enabled;
	}

	listConfig(): Record<string, string> {
		return {
			...this.repositories.allConfig(),
			maintenance: this.isMaintenance() ? 'true' : 'false',
			whitelist: this.isWhitelistEnabled() ? 'true' : 'false',
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
