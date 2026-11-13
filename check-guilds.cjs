const { REST } = require('discord.js');
const { readFileSync } = require('node:fs');

const env = {};
readFileSync('.env', 'utf8')
	.split(/\r?\n/)
	.filter((line) => line.trim() && !line.startsWith('#'))
	.forEach((line) => {
		const index = line.indexOf('=');
		env[line.slice(0, index).trim()] = line
			.slice(index + 1)
			.trim()
			.replace(/^["']|["']$/g, '');
	});

(async () => {
	const rest = new REST({ version: '10' }).setToken(
		env.DISCORD_BOT_TOKEN,
	);

	const guilds = await rest.get('/users/@me/guilds');

	console.log(`the bot is in ${guilds.length} server(s):\n`);
	for (const guild of guilds) {
		console.log(`  ${guild.name}  ->  GUILD_ID=${guild.id}`);
	}
})();
