import { existsSync, readFileSync } from 'node:fs';
import { ConfigError } from './utils/errors';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVELS: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

export type Config = {
	botToken: string;
	clientId: string;
	clientSecret: string | null;
	redirectUri: string | null;
	guildId: string | null;
	guildIds: string[];
	/** The ids of the bot owners - all of them get the same full access. */
	ownerIds: string[];
	adminRoleId: string | null;
	encryptionKey: Buffer;
	databasePath: string;
	questCatalogPath: string;
	logLevel: LogLevel;
	notificationIntervalMinutes: number;
	port: number;
	/**
	 * The prefix for the owner-only commands (for example `!admin stats`).
	 * Public commands keep slash commands.
	 */
	prefix: string;
	/** A Discord webhook URL in the developer guild that receives every room
	 *  event. Optional - when unset, no webhook posts are sent. */
	webhookUrl: string | null;
	/**
	 * Public channel for the "new quest discovered" announcements.
	 * Optional - when unset, announcements are tracked in the database but
	 * never posted. Does not change NOTIFY_CHANNEL_ID (status messages).
	 */
	publicQuestChannelId: string | null;
	/**
	 * Auto-pilot: run the runnable quests of the operator scope without a
	 * command (periodic sweep + immediate sweep on a newly discovered quest).
	 * AUTO_PILOT=false turns it off. Default: on.
	 */
	autoPilotEnabled: boolean;
	/** Seconds between two auto-pilot sweeps. AUTO_PILOT_INTERVAL_SECONDS,
	 *  default 10, minimum 10 (every sweep talks to Discord). */
	autoPilotIntervalSeconds: number;
	/** QUEST_MONITORING_ENABLED - automatic new-quest detection. Default: on. */
	questMonitoringEnabled: boolean;
	/** QUEST_MONITOR_INTERVAL_MINUTES - default NOTIFICATION_INTERVAL_MINUTES. */
	questMonitorIntervalMinutes: number;
	/** QUEST_IMAGES_ENABLED - render quest images/banners. Default: on. */
	questImagesEnabled: boolean;
	/** QUEST_VIDEOS_ENABLED - render a validated promotional video link. Default: on. */
	questVideosEnabled: boolean;
	/** QUEST_MEDIA_FALLBACK - neutral branding or no media block. */
	questMediaFallback: 'neutral' | 'omit';
	/**
	 * Mandatory guild membership for DM commands. Setting REQUIRED_GUILD_ID
	 * enables it unless explicitly switched off.
	 */
	membershipVerificationEnabled: boolean;
	requiredGuildId: string | null;
	requiredGuildInvite: string | null;
	membershipVerifyIntervalMinutes: number;
	/** Opt in to the privileged Server Members gateway intent. */
	membershipMemberEvents: boolean;
	/**
	 * Automatic encrypted-database snapshots to the existing WEBHOOK_URL.
	 * Explicit opt-in: the snapshot contains encrypted account data.
	 */
	webhookBackupEnabled: boolean;
	webhookBackupIntervalMinutes: number;
	webhookBackupMaxBytes: number;
};

function readDotEnv(
	env: NodeJS.ProcessEnv,
	file = '.env',
): void {
	if (!existsSync(file)) return;

	for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const separator = trimmed.indexOf('=');
		if (separator === -1) continue;

		const key = trimmed.slice(0, separator).trim();
		const value = trimmed
			.slice(separator + 1)
			.trim()
			.replace(/^["']|["']$/g, '');

		if (env[key] === undefined) {
			env[key] = value;
		}
	}
}

/**
 * Derives a 32 byte key for AES-256-GCM. ENCRYPTION_KEY is preferred,
 * otherwise the client secret is used so a single secret has to be configured.
 *
 * There is no fallback key: a published default would let everybody decrypt
 * every stored token. The bot refuses to start without a real secret.
 */
function deriveKey(env: NodeJS.ProcessEnv): Buffer {
	const secret =
		env.ENCRYPTION_KEY?.trim() || env.DISCORD_CLIENT_SECRET?.trim();

	if (!secret) {
		throw new ConfigError(
			'ENCRYPTION_KEY is not set. It protects every stored token, so the ' +
				'bot refuses to start without it. Generate one with ' +
				'"openssl rand -hex 32" and put it into the environment or the .env file.',
		);
	}

	return Buffer.from(
		require('node:crypto')
			.createHash('sha256')
			.update(secret)
			.digest(),
	);
}

/** Accepts the same explicit off words across all boolean options. */
function flag(raw: string | undefined, fallback: boolean): boolean {
	const value = raw?.trim();
	if (!value) return fallback;
	return !/^(false|0|off|no)$/i.test(value);
}

function positiveInt(raw: string | undefined, fallback: number): number {
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0
		? Math.max(1, Math.floor(parsed))
		: fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	readDotEnv(env, env.DOTENV_PATH ?? '.env');

	const botToken = env.DISCORD_BOT_TOKEN?.trim() || env.BOT_TOKEN?.trim();
	const clientId = env.DISCORD_CLIENT_ID?.trim();

	const missing: string[] = [];
	if (!botToken) missing.push('DISCORD_BOT_TOKEN');
	if (!clientId) missing.push('DISCORD_CLIENT_ID');

	if (missing.length > 0) {
		throw new ConfigError(
			`Missing required environment variable(s): ${missing.join(', ')}. ` +
				'Copy .env.example to .env and fill it in.',
		);
	}

	const rawLevel = (env.LOG_LEVEL ?? 'INFO').toUpperCase() as LogLevel;
	const logLevel = LOG_LEVELS.includes(rawLevel) ? rawLevel : 'INFO';

	// Guild scoped commands appear instantly, global ones can take an hour.
	const guildIds = (env.GUILD_ID ?? '')
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);

	// Several owners may be given at once - all of them get the same full
	// access. Comma separated, just like GUILD_ID.
	const ownerIds = (env.OWNER_ID ?? '')
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);

	// Auto-pilot is on unless it is explicitly switched off, and a sweep
	// never runs faster than every 10 seconds (each sweep talks to Discord).
	const autoPilotEnabled = !/^(false|0|off|no)$/i.test(
		env.AUTO_PILOT?.trim() ?? '',
	);

	const autoPilotIntervalSeconds = Math.max(
		10,
		positiveInt(env.AUTO_PILOT_INTERVAL_SECONDS, 10),
	);

	const notificationIntervalMinutes = Math.max(
		1,
		Number(env.NOTIFICATION_INTERVAL_MINUTES ?? 15),
	);

	// Membership: the presence of REQUIRED_GUILD_ID is an implicit opt-in so
	// an operator only has to set one variable. An explicit off flag always
	// wins; an explicit on flag without a guild is a startup error rather
	// than a silently unenforced rule.
	const requiredGuildId = env.REQUIRED_GUILD_ID?.trim() || null;
	const membershipVerificationEnabled = flag(
		env.MEMBERSHIP_VERIFICATION_ENABLED,
		Boolean(requiredGuildId),
	);

	if (membershipVerificationEnabled && !requiredGuildId) {
		throw new ConfigError(
			'Membership verification is enabled but REQUIRED_GUILD_ID is not set. ' +
				'Set the guild id or set MEMBERSHIP_VERIFICATION_ENABLED=false.',
		);
	}

	const fallbackMedia = env.QUEST_MEDIA_FALLBACK?.trim().toLowerCase();

	return {
		botToken: botToken as string,
		clientId: clientId as string,
		clientSecret: env.DISCORD_CLIENT_SECRET?.trim() || null,
		redirectUri: env.DISCORD_REDIRECT_URI?.trim() || null,
		guildId: guildIds[0] ?? null,
		guildIds,
		ownerIds,
		adminRoleId: env.ADMIN_ROLE_ID?.trim() || null,
		encryptionKey: deriveKey(env),
		databasePath: env.DATABASE_PATH?.trim() || 'data/quest-bot.sqlite',
		questCatalogPath:
			env.QUEST_CATALOG_PATH?.trim() || 'quest.json',
		logLevel,
		notificationIntervalMinutes,
		port: Number(env.PORT ?? 3000),
		prefix: env.PREFIX?.trim() || '!',
		webhookUrl: env.WEBHOOK_URL?.trim() || null,
		publicQuestChannelId:
			env.PUBLIC_QUEST_CHANNEL_ID?.trim() || null,
		autoPilotEnabled,
		autoPilotIntervalSeconds,
		questMonitoringEnabled: flag(env.QUEST_MONITORING_ENABLED, true),
		questMonitorIntervalMinutes: positiveInt(
			env.QUEST_MONITOR_INTERVAL_MINUTES,
			notificationIntervalMinutes,
		),
		questImagesEnabled: flag(env.QUEST_IMAGES_ENABLED, true),
		questVideosEnabled: flag(env.QUEST_VIDEOS_ENABLED, true),
		questMediaFallback:
			fallbackMedia === 'omit' ? 'omit' : 'neutral',
		membershipVerificationEnabled,
		requiredGuildId,
		requiredGuildInvite:
			env.REQUIRED_GUILD_INVITE?.trim() || null,
		membershipVerifyIntervalMinutes: positiveInt(
			env.MEMBERSHIP_VERIFY_INTERVAL_MINUTES,
			30,
		),
		membershipMemberEvents: flag(
			env.MEMBERSHIP_MEMBER_EVENTS,
			false,
		),
		webhookBackupEnabled: flag(env.WEBHOOK_BACKUP_ENABLED, false),
		webhookBackupIntervalMinutes: positiveInt(
			env.WEBHOOK_BACKUP_INTERVAL_MINUTES,
			60,
		),
		webhookBackupMaxBytes: Math.min(
			25 * 1024 * 1024,
			positiveInt(env.WEBHOOK_BACKUP_MAX_MB, 20) * 1024 * 1024,
		),
	};
}
