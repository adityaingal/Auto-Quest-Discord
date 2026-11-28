const { loadConfig } = require('../bot/config');

const REQUIRED = [
	'DISCORD_BOT_TOKEN',
	'DISCORD_CLIENT_ID',
	'ENCRYPTION_KEY',
];
const OPTIONAL = [
	'DISCORD_CLIENT_SECRET',
	'DISCORD_REDIRECT_URI',
	'OWNER_ID',
	'ADMIN_ROLE_ID',
	'GUILD_ID',
	'DATABASE_PATH',
	'QUEST_CATALOG_PATH',
	'LOG_LEVEL',
	'NOTIFICATION_INTERVAL_MINUTES',
	'PUBLIC_QUEST_CHANNEL_ID',
	'QUEST_MONITORING_ENABLED',
	'QUEST_MONITOR_INTERVAL_MINUTES',
	'QUEST_IMAGES_ENABLED',
	'QUEST_VIDEOS_ENABLED',
	'QUEST_MEDIA_FALLBACK',
	'REQUIRED_GUILD_ID',
	'REQUIRED_GUILD_INVITE',
	'MEMBERSHIP_VERIFICATION_ENABLED',
	'MEMBERSHIP_VERIFY_INTERVAL_MINUTES',
	'MEMBERSHIP_MEMBER_EVENTS',
	'WEBHOOK_BACKUP_ENABLED',
	'WEBHOOK_BACKUP_INTERVAL_MINUTES',
	'WEBHOOK_BACKUP_MAX_MB',
	'AUTO_PILOT',
	'AUTO_PILOT_INTERVAL_SECONDS',
	'PORT',
	'WEBHOOK_URL',
];

const raw = require('node:fs')
	.readFileSync('.env', 'utf8')
	.split(/\r?\n/)
	.map((line) => line.trim())
	.filter((line) => line && !line.startsWith('#'));

const values = new Map(
	raw.map((line) => {
		const index = line.indexOf('=');
		return [
			line.slice(0, index).trim(),
			line.slice(index + 1).trim(),
		];
	}),
);

console.log('=== .env ===');
for (const key of REQUIRED) {
	const value = values.get(key);
	const state =
		value && value.length > 0
			? `SET (${value.length} chars)`
			: 'MISSING';
	console.log(`${key.padEnd(32)} ${state}${key === 'REQUIRED' ? '' : ''}`);
}

console.log('');
console.log('=== optional ===');
for (const key of OPTIONAL) {
	const value = values.get(key);
	console.log(
		`${key.padEnd(32)} ${
			value && value.length > 0 ? `SET (${value.length} chars)` : 'not set'
		}`,
	);
}

console.log('');
try {
	const config = loadConfig({
		...process.env,
		DOTENV_PATH: '.env',
	});
	console.log('config loads OK');
	console.log(`  log level      : ${config.logLevel}`);
	console.log(`  database       : ${config.databasePath}`);
	console.log(`  catalogue      : ${config.questCatalogPath}`);
	console.log(`  oauth2 enabled : ${Boolean(config.clientSecret && config.redirectUri)}`);
	console.log(`  encryption key : ${config.encryptionKey.length} bytes`);
	console.log(`  port           : ${config.port}`);
	console.log(
		`  auto-pilot     : ${
			config.autoPilotEnabled
				? `on (every ${config.autoPilotIntervalSeconds}s)`
				: 'off'
		}`,
	);
	console.log(
		`  quest monitor  : ${
			config.questMonitoringEnabled
				? `on (every ${config.questMonitorIntervalMinutes}m)`
				: 'off'
		}`,
	);
	console.log(
		`  media          : images ${config.questImagesEnabled ? 'on' : 'off'}, videos ${config.questVideosEnabled ? 'on' : 'off'}, fallback ${config.questMediaFallback}`,
	);
	console.log(
		`  membership     : ${
			config.membershipVerificationEnabled
				? `on (guild ${config.requiredGuildId})`
				: 'off'
		}`,
	);
	console.log(
		`  webhook backup : ${config.webhookBackupEnabled ? `on (every ${config.webhookBackupIntervalMinutes}m)` : 'off'}`,
	);
} catch (error) {
	console.log(`config error: ${error.message}`);
}
