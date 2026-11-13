import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Migration = {
	version: number;
	name: string;
	sql: string;
};

/**
 * Schema migrations. Never edit an applied migration - add a new one.
 * Existing databases are upgraded in place, data is never dropped.
 */
export const MIGRATIONS: Migration[] = [
	{
		version: 1,
		name: 'initial_schema',
		sql: `
			CREATE TABLE IF NOT EXISTS users (
				discord_user_id TEXT PRIMARY KEY,
				username TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);

			CREATE TABLE IF NOT EXISTS account_links (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				discord_user_id TEXT NOT NULL,
				discord_account_id TEXT NOT NULL,
				discord_username TEXT,
				access_token TEXT,
				refresh_token TEXT,
				expires_at TEXT,
				scopes TEXT,
				status TEXT NOT NULL DEFAULT 'active',
				linked_at TEXT NOT NULL DEFAULT (datetime('now')),
				revoked_at TEXT,
				UNIQUE (discord_user_id, discord_account_id)
			);

			CREATE INDEX IF NOT EXISTS idx_account_links_user
				ON account_links (discord_user_id);

			CREATE TABLE IF NOT EXISTS quest_records (
				quest_id TEXT PRIMARY KEY,
				name TEXT,
				application_id TEXT,
				application_name TEXT,
				content_type INTEGER,
				platforms TEXT,
				tasks TEXT,
				rewards TEXT,
				expires_at TEXT,
				source TEXT,
				config TEXT,
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);

			CREATE TABLE IF NOT EXISTS quest_progress (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				discord_user_id TEXT NOT NULL,
				quest_id TEXT NOT NULL,
				status TEXT NOT NULL,
				value INTEGER NOT NULL DEFAULT 0,
				target INTEGER NOT NULL DEFAULT 0,
				percent REAL NOT NULL DEFAULT 0,
				enrolled_at TEXT,
				completed_at TEXT,
				claimed_at TEXT,
				updated_at TEXT NOT NULL DEFAULT (datetime('now')),
				UNIQUE (discord_user_id, quest_id)
			);

			CREATE TABLE IF NOT EXISTS quest_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				discord_user_id TEXT NOT NULL,
				quest_id TEXT,
				event_type TEXT NOT NULL,
				detail TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);

			CREATE INDEX IF NOT EXISTS idx_quest_history_user
				ON quest_history (discord_user_id, created_at DESC);

			CREATE TABLE IF NOT EXISTS reward_records (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				discord_user_id TEXT NOT NULL,
				quest_id TEXT NOT NULL,
				reward_name TEXT,
				reward_type INTEGER,
				orb_quantity INTEGER,
				status TEXT NOT NULL DEFAULT 'unknown',
				claimed_at TEXT,
				updated_at TEXT NOT NULL DEFAULT (datetime('now')),
				UNIQUE (discord_user_id, quest_id)
			);

			CREATE TABLE IF NOT EXISTS notification_settings (
				discord_user_id TEXT PRIMARY KEY,
				new_quests INTEGER NOT NULL DEFAULT 1,
				progress INTEGER NOT NULL DEFAULT 1,
				completion INTEGER NOT NULL DEFAULT 1,
				rewards INTEGER NOT NULL DEFAULT 1,
				expiry INTEGER NOT NULL DEFAULT 1,
				interval_minutes INTEGER NOT NULL DEFAULT 15,
				channel_id TEXT,
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);

			CREATE TABLE IF NOT EXISTS guild_settings (
				guild_id TEXT PRIMARY KEY,
				notify_channel_id TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);

			CREATE TABLE IF NOT EXISTS admin_logs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				actor_id TEXT,
				action TEXT NOT NULL,
				detail TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);

			CREATE TABLE IF NOT EXISTS bot_config (
				key TEXT PRIMARY KEY,
				value TEXT,
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);

			CREATE TABLE IF NOT EXISTS oauth_states (
				state TEXT PRIMARY KEY,
				discord_user_id TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
		`,
	},
	{
		version: 2,
		name: 'bot_tokens',
		sql: `
			CREATE TABLE IF NOT EXISTS bot_tokens (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				label TEXT NOT NULL,
				token TEXT NOT NULL,
				application_id TEXT,
				bot_user_id TEXT,
				bot_username TEXT,
				status TEXT NOT NULL DEFAULT 'active',
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				last_checked_at TEXT,
				UNIQUE (label)
			);
		`,
	},
	{
		version: 3,
		name: 'token_types',
		sql: `
			ALTER TABLE bot_tokens RENAME TO tokens;
			ALTER TABLE tokens ADD COLUMN type TEXT NOT NULL DEFAULT 'bot';
			ALTER TABLE tokens ADD COLUMN account_id TEXT;
			ALTER TABLE tokens ADD COLUMN account_username TEXT;
		`,
	},
	{
		version: 4,
		name: 'whitelist',
		sql: `
			CREATE TABLE IF NOT EXISTS whitelist (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				kind TEXT NOT NULL,
				entry_id TEXT NOT NULL,
				label TEXT,
				added_by TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				UNIQUE (kind, entry_id)
			);
		`,
	},
	{
		version: 5,
		name: 'whitelist_roles',
		sql: `
			ALTER TABLE whitelist ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
		`,
	},
	{
		version: 6,
		name: 'rooms',
		sql: `
			CREATE TABLE IF NOT EXISTS rooms (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				owner_user_id TEXT NOT NULL,
				name TEXT NOT NULL,
				description TEXT,
				webhook_id TEXT,
				webhook_token TEXT,
				webhook_reveal INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now')),
				expires_at TEXT NOT NULL,
				UNIQUE (owner_user_id, name)
			);

			CREATE INDEX IF NOT EXISTS idx_rooms_owner
				ON rooms (owner_user_id);

			CREATE TABLE IF NOT EXISTS room_accounts (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				room_id INTEGER NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
				slot INTEGER NOT NULL,
				token TEXT NOT NULL,
				account_id TEXT,
				account_username TEXT,
				status TEXT NOT NULL DEFAULT 'active',
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				last_checked_at TEXT,
				UNIQUE (room_id, slot)
			);

			CREATE INDEX IF NOT EXISTS idx_room_accounts_room
				ON room_accounts (room_id, slot ASC);
		`,
	},
	{
		version: 7,
		name: 'drop_per_room_webhooks',
		sql: `
			ALTER TABLE rooms DROP COLUMN webhook_id;
			ALTER TABLE rooms DROP COLUMN webhook_token;
			ALTER TABLE rooms DROP COLUMN webhook_reveal;
		`,
	},
];

export class Database {
	private db: DatabaseSync;
	private readonly path: string;

	constructor(path: string) {
		this.path = path;

		if (path !== ':memory:') {
			mkdirSync(dirname(path), { recursive: true });
		}

		this.db = new DatabaseSync(path);
		this.db.exec('PRAGMA journal_mode = WAL;');
		this.db.exec('PRAGMA foreign_keys = ON;');
	}

	/** Closes and re-opens the database file (used after a restore). */
	reopen(): void {
		this.db.close();
		this.db = new DatabaseSync(this.path);
		this.db.exec('PRAGMA journal_mode = WAL;');
		this.db.exec('PRAGMA foreign_keys = ON;');
	}

	migrate(): number[] {
		this.db.exec(
			"CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
		);

		const applied = new Set(
			this.all<{ version: number }>(
				'SELECT version FROM schema_migrations',
			).map((row) => row.version),
		);

		const executed: number[] = [];

		for (const migration of MIGRATIONS) {
			if (applied.has(migration.version)) continue;

			this.db.exec('BEGIN');
			try {
				this.db.exec(migration.sql);
				this.db
					.prepare(
						'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
					)
					.run(migration.version, migration.name);
				this.db.exec('COMMIT');
				executed.push(migration.version);
			} catch (error) {
				this.db.exec('ROLLBACK');
				throw error;
			}
		}

		return executed;
	}

	run(sql: string, ...params: unknown[]): { changes: number } {
		const result = this.db.prepare(sql).run(...(params as never[]));
		return {
			changes: Number(result?.changes ?? 0),
		};
	}

	/** Runs a statement and returns the id of the inserted row. */
	insert(sql: string, ...params: unknown[]): number {
		const result = this.db.prepare(sql).run(...(params as never[]));
		return Number(result?.lastInsertRowid ?? 0);
	}

	get<T>(sql: string, ...params: unknown[]): T | undefined {
		return this.db.prepare(sql).get(...(params as never[])) as
			| T
			| undefined;
	}

	all<T>(sql: string, ...params: unknown[]): T[] {
		return this.db.prepare(sql).all(...(params as never[])) as T[];
	}

	transaction<T>(fn: () => T): T {
		this.db.exec('BEGIN');
		try {
			const result = fn();
			this.db.exec('COMMIT');
			return result;
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}

	/** Creates a consistent copy of the database file. */
	backup(targetPath: string): string {
		this.db.exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`);
		return targetPath;
	}

	close(): void {
		this.db.close();
	}
}
