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

	const commands = await rest.get(
		`/applications/${env.DISCORD_CLIENT_ID}/commands`,
	);

	console.log('commands registered at Discord:');
	for (const command of commands) {
		console.log(`\n/${command.name} - "${command.description}"`);
		for (const option of command.options ?? []) {
			console.log(
				`   - ${option.name} (type ${option.type})${
					option.type === 1 ? ` -> ${option.options?.length ?? 0} subcommands` : ''
				}`,
			);
			for (const sub of option.options ?? []) {
				console.log(
					`       * ${sub.name}: ${
						(sub.options ?? [])
							.map(
								(o) =>
									`${o.name}(${o.type}${
										o.choices ? ' choices:' : ''
									}${
										o.choices
											? o.choices.map((c) => c.name).join('/')
											: ''
									})`,
							)
							.join(', ') || 'no options'
					}`,
				);
			}
		}
	}
})();
