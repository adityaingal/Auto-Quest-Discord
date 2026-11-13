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
	'PORT',
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
} catch (error) {
	console.log(`config error: ${error.message}`);
}
