import { Client } from 'discord.js';
import { Routes } from 'discord-api-types/v10';
import { Config } from '../config';
import { CommandDefinition } from './types';
import { questCommand } from './quest';
import { accountCommand } from './account';
import { taskCommand } from './task';
import { rewardCommand } from './reward';
import { adminCommand } from './admin';
import { tokenCommand } from './token';

export const commands: CommandDefinition[] = [
	questCommand,
	accountCommand,
	taskCommand,
	rewardCommand,
	adminCommand,
	tokenCommand,
];

export const commandNames = commands.map((command) => command.data.name);

/**
 * Registers the slash commands. Guild scoped registration is instant, global
 * registration can take up to an hour to propagate. Several guilds can be
 * given (comma separated in GUILD_ID).
 */
export async function registerCommands(
	client: Client,
	config: Config,
): Promise<number> {
	const body = commands.map((command) => command.data.toJSON());
	const applicationId = client.application?.id ?? config.clientId;

	if (config.guildIds.length > 0) {
		for (const guildId of config.guildIds) {
			await client.rest.put(
				Routes.applicationGuildCommands(applicationId, guildId),
				{ body },
			);
		}

		return body.length;
	}

	await client.rest.put(Routes.applicationCommands(applicationId), {
		body,
	});

	return body.length;
}
