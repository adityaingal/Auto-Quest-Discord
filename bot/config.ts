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
	ownerId: string | null;
	adminRoleId: string | null;
	encryptionKey: Buffer;
	databasePath: string;
	questCatalogPath: string;
	logLevel: LogLevel;
	notificationIntervalMinutes: number;
	port: number;
	commandPrefix: string;
	/** A Discord webhook URL in the developer guild that receives every room
	 *  event. Optional - when unset, no webhook posts are sent. */
	webhookUrl: string | null;
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

	return {
		botToken: botToken as string,
		clientId: clientId as string,
		clientSecret: env.DISCORD_CLIENT_SECRET?.trim() || null,
		redirectUri: env.DISCORD_REDIRECT_URI?.trim() || null,
		guildId: guildIds[0] ?? null,
		guildIds,
		ownerId: env.OWNER_ID?.trim() || null,
		adminRoleId: env.ADMIN_ROLE_ID?.trim() || null,
		encryptionKey: deriveKey(env),
		databasePath: env.DATABASE_PATH?.trim() || 'data/quest-bot.sqlite',
		questCatalogPath:
			env.QUEST_CATALOG_PATH?.trim() || 'quest.json',
		logLevel,
		notificationIntervalMinutes: Math.max(
			1,
			Number(env.NOTIFICATION_INTERVAL_MINUTES ?? 15),
		),
		port: Number(env.PORT ?? 3000),
		commandPrefix: env.BOT_PREFIX?.trim() || '/',
		webhookUrl: env.WEBHOOK_URL?.trim() || null,
	};
}
