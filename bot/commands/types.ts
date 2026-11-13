import {
	ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
	SlashCommandSubcommandBuilder,
	SlashCommandSubcommandGroupBuilder,
} from 'discord.js';
import { Services } from '../services';
import { AccountScope } from '../services/scope';

export type CommandContext = {
	interaction: ChatInputCommandInteraction;
	services: Services;
	userId: string;
	guildId: string | null;
	/**
	 * What the caller may reach. It is built from the user id, so it always
	 * matches the account that runs the command.
	 */
	scope: AccountScope;
};

export type CommandHandler = (context: CommandContext) => Promise<void>;

export type CommandDefinition = {
	data: SlashCommandBuilder;
	execute: CommandHandler;
};

type SubcommandEntry = {
	name: string;
	description: string;
	run: CommandHandler;
	build?: (builder: SlashCommandSubcommandBuilder) => void;
};

type SubcommandGroupEntry = {
	name: string;
	description: string;
	subcommands: SubcommandEntry[];
};

/**
 * Helper for subcommand groups: every group is a single slash command with
 * subcommands, dispatched by name. A subcommand can itself be a group of
 * subcommands (type 2 in the Discord API).
 */
export function group(
	name: string,
	description: string,
	subcommands: (
		| SubcommandEntry
		| (Omit<SubcommandEntry, 'run'> & { subcommands: SubcommandEntry[] })
	)[],
): CommandDefinition {
	const builder = new SlashCommandBuilder()
		.setName(name)
		.setDescription(description);

	for (const subcommand of subcommands) {
		if ('subcommands' in subcommand && subcommand.subcommands) {
			const groupBuilder = new SlashCommandSubcommandGroupBuilder()
				.setName(subcommand.name)
				.setDescription(subcommand.description);

			for (const nested of subcommand.subcommands) {
				const nestedBuilder = new SlashCommandSubcommandBuilder()
					.setName(nested.name)
					.setDescription(nested.description);

				if (nested.build) nested.build(nestedBuilder);
				groupBuilder.addSubcommand(nestedBuilder);
			}

			builder.addSubcommandGroup(groupBuilder);
			continue;
		}

		const sub = new SlashCommandSubcommandBuilder()
			.setName(subcommand.name)
			.setDescription(subcommand.description);

		if (subcommand.build) subcommand.build(sub);

		builder.addSubcommand(sub);
	}

	return {
		data: builder,
		execute: async (context) => {
			const groupName = context.interaction.options.getSubcommandGroup(
				false,
			);
			const subcommandName = context.interaction.options.getSubcommand(
				false,
			);

			const entries = subcommands as (
				| SubcommandEntry
				| SubcommandGroupEntry
			)[];
			if (groupName) {
				const groupEntry = entries.find(
					(item): item is SubcommandGroupEntry =>
						'name' in item &&
						item.name === groupName &&
						'subcommands' in item,
				);
				const nested = groupEntry?.subcommands?.find(
					(item) => item.name === subcommandName,
				);

				if (!nested) {
					await context.interaction.reply({
						content: 'Unknown subcommand.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				await nested.run(context);
				return;
			}

			const entry = entries.find(
				(item): item is SubcommandEntry =>
					'run' in item && item.name === subcommandName,
			);

			if (!entry) {
				await context.interaction.reply({
					content: 'Unknown subcommand.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			await entry.run(context);
		},
	};
}
