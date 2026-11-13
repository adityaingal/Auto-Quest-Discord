import { Database } from './index';

export type AccountLink = {
	id: number;
	discord_user_id: string;
	discord_account_id: string;
	discord_username: string | null;
	access_token: string | null;
	refresh_token: string | null;
	expires_at: string | null;
	scopes: string | null;
	status: 'active' | 'expired' | 'revoked';
	linked_at: string;
	revoked_at: string | null;
};

export type QuestProgressRow = {
	discord_user_id: string;
	quest_id: string;
	status: string;
	value: number;
	target: number;
	percent: number;
	enrolled_at: string | null;
	completed_at: string | null;
	claimed_at: string | null;
	updated_at: string;
};

export type NotificationSettings = {
	discord_user_id: string;
	new_quests: number;
	progress: number;
	completion: number;
	rewards: number;
	expiry: number;
	interval_minutes: number;
	channel_id: string | null;
};

export type HistoryRow = {
	id: number;
	discord_user_id: string;
	quest_id: string | null;
	event_type: string;
	detail: string | null;
	created_at: string;
};

export class Repositories {
	constructor(private readonly db: Database) {}

	/** Runs a set of writes in a single transaction. */
	transaction<T>(fn: () => T): T {
		return this.db.transaction(fn);
	}

	// ---------------------------------------------------------------- users

	upsertUser(discordUserId: string, username: string | null): void {
		this.db.run(
			`INSERT INTO users (discord_user_id, username) VALUES (?, ?)
			 ON CONFLICT(discord_user_id) DO UPDATE SET
				username = excluded.username,
				updated_at = datetime('now')`,
			discordUserId,
			username,
		);
	}

	countUsers(): number {
		return (
			this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM users')
				?.count ?? 0
		);
	}

	listUsers(limit = 25): {
		discord_user_id: string;
		username: string | null;
		created_at: string;
	}[] {
		return this.db.all(
			'SELECT discord_user_id, username, created_at FROM users ORDER BY created_at DESC LIMIT ?',
			limit,
		);
	}

	// -------------------------------------------------------- account links

	linkAccount(row: {
		discord_user_id: string;
		discord_account_id: string;
		discord_username: string | null;
		access_token: string;
		refresh_token: string | null;
		expires_at: string | null;
		scopes: string | null;
	}): void {
		this.db.run(
			`INSERT INTO account_links
				(discord_user_id, discord_account_id, discord_username,
				 access_token, refresh_token, expires_at, scopes, status, revoked_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL)
			 ON CONFLICT(discord_user_id, discord_account_id) DO UPDATE SET
				discord_username = excluded.discord_username,
				access_token = excluded.access_token,
				refresh_token = excluded.refresh_token,
				expires_at = excluded.expires_at,
				scopes = excluded.scopes,
				status = 'active',
				revoked_at = NULL`,
			row.discord_user_id,
			row.discord_account_id,
			row.discord_username,
			row.access_token,
			row.refresh_token,
			row.expires_at,
			row.scopes,
		);
	}

	getLink(discordUserId: string): AccountLink | undefined {
		return this.db.get<AccountLink>(
			'SELECT * FROM account_links WHERE discord_user_id = ? AND status = \'active\' ORDER BY id DESC LIMIT 1',
			discordUserId,
		);
	}

	listLinks(discordUserId: string): AccountLink[] {
		return this.db.all<AccountLink>(
			'SELECT * FROM account_links WHERE discord_user_id = ? ORDER BY id DESC',
			discordUserId,
		);
	}

	markLinkStatus(id: number, status: 'active' | 'expired' | 'revoked'): void {
		this.db.run(
			`UPDATE account_links SET status = ?, revoked_at = CASE WHEN ? = 'revoked' THEN datetime('now') ELSE revoked_at END WHERE id = ?`,
			status,
			status,
			id,
		);
	}

	unlinkAll(discordUserId: string): number {
		const result = this.db.run(
			'DELETE FROM account_links WHERE discord_user_id = ?',
			discordUserId,
		);
		return Number(result.changes ?? 0);
	}

	// ------------------------------------------------------- oauth states

	storeOauthState(state: string, discordUserId: string): void {
		this.db.run(
			'INSERT OR REPLACE INTO oauth_states (state, discord_user_id) VALUES (?, ?)',
			state,
			discordUserId,
		);
		this.db.run(
			"DELETE FROM oauth_states WHERE created_at < datetime('now', '-15 minutes')",
		);
	}

	/** Looks the state up without invalidating it. */
	peekOauthState(state: string): string | undefined {
		return this.db.get<{ discord_user_id: string }>(
			'SELECT discord_user_id FROM oauth_states WHERE state = ?',
			state,
		)?.discord_user_id;
	}

	consumeOauthState(state: string): string | undefined {
		const row = this.db.get<{ discord_user_id: string }>(
			'SELECT discord_user_id FROM oauth_states WHERE state = ?',
			state,
		);
		if (!row) return undefined;

		this.db.run('DELETE FROM oauth_states WHERE state = ?', state);
		return row.discord_user_id;
	}

	// ------------------------------------------------------------- quests

	saveQuest(quest: {
		quest_id: string;
		name: string | null;
		application_id: string | null;
		application_name: string | null;
		content_type: number | null;
		platforms: string | null;
		tasks: string | null;
		rewards: string | null;
		expires_at: string | null;
		source: string;
		config: string;
	}): void {
		this.db.run(
			`INSERT INTO quest_records
				(quest_id, name, application_id, application_name, content_type,
				 platforms, tasks, rewards, expires_at, source, config, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT(quest_id) DO UPDATE SET
				name = excluded.name,
				application_id = excluded.application_id,
				application_name = excluded.application_name,
				content_type = excluded.content_type,
				platforms = excluded.platforms,
				tasks = excluded.tasks,
				rewards = excluded.rewards,
				expires_at = excluded.expires_at,
				source = excluded.source,
				config = excluded.config,
				updated_at = datetime('now')`,
			quest.quest_id,
			quest.name,
			quest.application_id,
			quest.application_name,
			quest.content_type,
			quest.platforms,
			quest.tasks,
			quest.rewards,
			quest.expires_at,
			quest.source,
			quest.config,
		);
	}

	listQuestRecords(limit = 100): {
		quest_id: string;
		name: string | null;
		application_id: string | null;
		application_name: string | null;
		platforms: string | null;
		tasks: string | null;
		rewards: string | null;
		expires_at: string | null;
		source: string | null;
		updated_at: string;
	}[] {
		return this.db.all(
			'SELECT quest_id, name, application_id, application_name, platforms, tasks, rewards, expires_at, source, updated_at FROM quest_records ORDER BY updated_at DESC LIMIT ?',
			limit,
		);
	}

	// ----------------------------------------------------------- progress

	saveProgress(row: {
		discord_user_id: string;
		quest_id: string;
		status: string;
		value: number;
		target: number;
		percent: number;
		enrolled_at: string | null;
		completed_at: string | null;
		claimed_at: string | null;
	}): void {
		this.db.run(
			`INSERT INTO quest_progress
				(discord_user_id, quest_id, status, value, target, percent,
				 enrolled_at, completed_at, claimed_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT(discord_user_id, quest_id) DO UPDATE SET
				status = excluded.status,
				value = excluded.value,
				target = excluded.target,
				percent = excluded.percent,
				enrolled_at = excluded.enrolled_at,
				completed_at = excluded.completed_at,
				claimed_at = excluded.claimed_at,
				updated_at = datetime('now')`,
			row.discord_user_id,
			row.quest_id,
			row.status,
			row.value,
			row.target,
			row.percent,
			row.enrolled_at,
			row.completed_at,
			row.claimed_at,
		);
	}

	listProgress(discordUserId: string): QuestProgressRow[] {
		return this.db.all<QuestProgressRow>(
			'SELECT * FROM quest_progress WHERE discord_user_id = ? ORDER BY updated_at DESC',
			discordUserId,
		);
	}

	getProgress(
		discordUserId: string,
		questId: string,
	): QuestProgressRow | undefined {
		return this.db.get<QuestProgressRow>(
			'SELECT * FROM quest_progress WHERE discord_user_id = ? AND quest_id = ?',
			discordUserId,
			questId,
		);
	}

	// ------------------------------------------------------------ history

	addHistory(
		discordUserId: string,
		questId: string | null,
		eventType: string,
		detail: string | null,
	): void {
		this.db.run(
			'INSERT INTO quest_history (discord_user_id, quest_id, event_type, detail) VALUES (?, ?, ?, ?)',
			discordUserId,
			questId,
			eventType,
			detail,
		);
	}

	listHistory(discordUserId: string, limit = 25): HistoryRow[] {
		return this.db.all<HistoryRow>(
			'SELECT * FROM quest_history WHERE discord_user_id = ? ORDER BY created_at DESC LIMIT ?',
			discordUserId,
			limit,
		);
	}

	countHistory(): number {
		return (
			this.db.get<{ count: number }>(
				'SELECT COUNT(*) AS count FROM quest_history',
			)?.count ?? 0
		);
	}

	// ------------------------------------------------------------ rewards

	saveReward(row: {
		discord_user_id: string;
		quest_id: string;
		reward_name: string | null;
		reward_type: number | null;
		orb_quantity: number | null;
		status: string;
		claimed_at: string | null;
	}): void {
		this.db.run(
			`INSERT INTO reward_records
				(discord_user_id, quest_id, reward_name, reward_type, orb_quantity,
				 status, claimed_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT(discord_user_id, quest_id) DO UPDATE SET
				reward_name = excluded.reward_name,
				reward_type = excluded.reward_type,
				orb_quantity = excluded.orb_quantity,
				status = excluded.status,
				claimed_at = excluded.claimed_at,
				updated_at = datetime('now')`,
			row.discord_user_id,
			row.quest_id,
			row.reward_name,
			row.reward_type,
			row.orb_quantity,
			row.status,
			row.claimed_at,
		);
	}

	listRewards(discordUserId: string): {
		quest_id: string;
		reward_name: string | null;
		reward_type: number | null;
		orb_quantity: number | null;
		status: string;
		claimed_at: string | null;
		updated_at: string;
	}[] {
		return this.db.all(
			'SELECT quest_id, reward_name, reward_type, orb_quantity, status, claimed_at, updated_at FROM reward_records WHERE discord_user_id = ? ORDER BY updated_at DESC',
			discordUserId,
		);
	}

	// --------------------------------------------------- notification cfg

	getNotificationSettings(
		discordUserId: string,
	): NotificationSettings | undefined {
		return this.db.get<NotificationSettings>(
			'SELECT * FROM notification_settings WHERE discord_user_id = ?',
			discordUserId,
		);
	}

	upsertNotificationSettings(settings: {
		discord_user_id: string;
		new_quests?: number;
		progress?: number;
		completion?: number;
		rewards?: number;
		expiry?: number;
		interval_minutes?: number;
		channel_id?: string | null;
	}): void {
		this.db.run(
			`INSERT INTO notification_settings
				(discord_user_id, new_quests, progress, completion, rewards, expiry,
				 interval_minutes, channel_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(discord_user_id) DO UPDATE SET
				new_quests = COALESCE(excluded.new_quests, notification_settings.new_quests),
				progress = COALESCE(excluded.progress, notification_settings.progress),
				completion = COALESCE(excluded.completion, notification_settings.completion),
				rewards = COALESCE(excluded.rewards, notification_settings.rewards),
				expiry = COALESCE(excluded.expiry, notification_settings.expiry),
				interval_minutes = COALESCE(excluded.interval_minutes, notification_settings.interval_minutes),
				channel_id = COALESCE(excluded.channel_id, notification_settings.channel_id),
				updated_at = datetime('now')`,
			settings.discord_user_id,
			settings.new_quests ?? 1,
			settings.progress ?? 1,
			settings.completion ?? 1,
			settings.rewards ?? 1,
			settings.expiry ?? 1,
			settings.interval_minutes ?? 15,
			settings.channel_id ?? null,
		);
	}

	listNotificationUsers(): NotificationSettings[] {
		return this.db.all<NotificationSettings>(
			'SELECT * FROM notification_settings',
		);
	}

	// -------------------------------------------------------------- guild

	setGuildChannel(guildId: string, channelId: string | null): void {
		this.db.run(
			`INSERT INTO guild_settings (guild_id, notify_channel_id) VALUES (?, ?)
			 ON CONFLICT(guild_id) DO UPDATE SET notify_channel_id = excluded.notify_channel_id`,
			guildId,
			channelId,
		);
	}

	getGuildChannel(guildId: string): string | null {
		return (
			this.db.get<{ notify_channel_id: string | null }>(
				'SELECT notify_channel_id FROM guild_settings WHERE guild_id = ?',
				guildId,
			)?.notify_channel_id ?? null
		);
	}

	// -------------------------------------------------------------- admin

	addAdminLog(actorId: string | null, action: string, detail: string | null): void {
		this.db.run(
			'INSERT INTO admin_logs (actor_id, action, detail) VALUES (?, ?, ?)',
			actorId,
			action,
			detail,
		);
	}

	listAdminLogs(limit = 25): {
		id: number;
		actor_id: string | null;
		action: string;
		detail: string | null;
		created_at: string;
	}[] {
		return this.db.all(
			'SELECT id, actor_id, action, detail, created_at FROM admin_logs ORDER BY created_at DESC LIMIT ?',
			limit,
		);
	}

	// ------------------------------------------------------------ bot tokens

	addBotToken(row: {
		label: string;
		token: string;
		type: 'bot' | 'user';
		application_id: string | null;
		bot_user_id: string | null;
		bot_username: string | null;
		account_id?: string | null;
		account_username?: string | null;
	}): void {
		this.db.run(
			`INSERT INTO tokens
				(label, token, type, application_id, bot_user_id, bot_username,
				 account_id, account_username, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
			 ON CONFLICT(label) DO UPDATE SET
				token = excluded.token,
				type = excluded.type,
				application_id = excluded.application_id,
				bot_user_id = excluded.bot_user_id,
				bot_username = excluded.bot_username,
				account_id = excluded.account_id,
				account_username = excluded.account_username,
				status = 'active'`,
			row.label,
			row.token,
			row.type,
			row.application_id,
			row.bot_user_id,
			row.bot_username,
			row.account_id ?? null,
			row.account_username ?? null,
		);
	}

	listBotTokens(): {
		id: number;
		label: string;
		token: string;
		type: 'bot' | 'user';
		application_id: string | null;
		bot_user_id: string | null;
		bot_username: string | null;
		account_id: string | null;
		account_username: string | null;
		status: string;
		created_at: string;
		last_checked_at: string | null;
	}[] {
		return this.db.all('SELECT * FROM tokens ORDER BY id ASC');
	}

	getBotToken(id: number): {
		id: number;
		label: string;
		token: string;
		type: 'bot' | 'user';
		application_id: string | null;
		bot_user_id: string | null;
		bot_username: string | null;
		account_id: string | null;
		account_username: string | null;
		status: string;
		created_at: string;
		last_checked_at: string | null;
	} | undefined {
		return this.db.get('SELECT * FROM tokens WHERE id = ?', id);
	}

	deleteBotToken(id: number): number {
		const result = this.db.run('DELETE FROM tokens WHERE id = ?', id);
		return result.changes;
	}

	touchBotToken(id: number, status: string): void {
		this.db.run(
			`UPDATE tokens SET status = ?, last_checked_at = datetime('now') WHERE id = ?`,
			status,
			id,
		);
	}

	// ----------------------------------------------------------- whitelist

	addWhitelist(entry: {
		kind: 'guild' | 'user';
		entry_id: string;
		label: string | null;
		added_by: string | null;
	}): void {
		this.db.run(
			`INSERT INTO whitelist (kind, entry_id, label, added_by)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(kind, entry_id) DO UPDATE SET
				label = excluded.label,
				added_by = excluded.added_by`,
			entry.kind,
			entry.entry_id,
			entry.label,
			entry.added_by,
		);
	}

	listWhitelist(kind?: 'guild' | 'user'): {
		id: number;
		kind: string;
		entry_id: string;
		label: string | null;
		added_by: string | null;
		created_at: string;
	}[] {
		return kind
			? this.db.all(
					'SELECT * FROM whitelist WHERE kind = ? ORDER BY id ASC',
					kind,
				)
			: this.db.all('SELECT * FROM whitelist ORDER BY kind, id ASC');
	}

	removeWhitelist(kind: 'guild' | 'user', entryId: string): number {
		const result = this.db.run(
			'DELETE FROM whitelist WHERE kind = ? AND entry_id = ?',
			kind,
			entryId,
		);
		return result.changes;
	}

	isWhitelisted(kind: 'guild' | 'user', entryId: string): boolean {
		return (
			this.db.get<{ id: number }>(
				'SELECT id FROM whitelist WHERE kind = ? AND entry_id = ?',
				kind,
				entryId,
			) !== undefined
		);
	}

	// ------------------------------------------------------------- config

	setConfig(key: string, value: string): void {		this.db.run(
			`INSERT INTO bot_config (key, value) VALUES (?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
			key,
			value,
		);
	}

	getConfig(key: string): string | undefined {
		return this.db.get<{ value: string }>(
			'SELECT value FROM bot_config WHERE key = ?',
			key,
		)?.value;
	}

	allConfig(): Record<string, string> {
		const rows = this.db.all<{ key: string; value: string }>(
			'SELECT key, value FROM bot_config',
		);
		return Object.fromEntries(rows.map((row) => [row.key, row.value]));
	}
}
