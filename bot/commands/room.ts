import { MessageFlags, SlashCommandSubcommandBuilder } from 'discord.js';
import { CommandContext, group } from './types';
import { infoEmbed, successEmbed, errorEmbed } from '../ui/embeds';
import { Room, RoomService } from '../services/roomService';

/**
 * A room name is also the name of a Discord channel-like thing the user
 * works with, so it gets an autocomplete over the rooms of the user.
 */
function roomNameOption(sub: SlashCommandSubcommandBuilder): void {
	sub.addStringOption((option) =>
		option
			.setName('room')
			.setDescription('The name of your room')
			.setRequired(true)
			.setAutocomplete(true),
	);
}

function roomEmbed(room: Room): ReturnType<typeof infoEmbed> {
	const accounts = room.accounts.length
		? room.accounts
				.map(
					(account) =>
						`**${account.slot}.** ${account.accountUsername ?? 'unknown account'} - \`${account.accountId ?? '?'}\`\n` +
						`token \`${account.masked}\` - ${account.status}`,
				)
				.join('\n\n')
		: 'No accounts yet - add one with `/room add`.';

	const fields = [
		{
			name: 'Accounts',
			value: accounts.slice(0, 1024),
		},
		{
			name: 'Created',
			value: room.createdAt,
			inline: true,
		},
		{
			name: 'Resets at',
			value: room.expiresAt,
			inline: true,
		},
	];

	return infoEmbed(
		`ROOM: ${room.name}`,
		[
			room.description ? room.description : 'No description.',
			'',
			room.expired
				? '⚠️ **This room has expired and will be reset.** Use `/room renew` to keep it.'
				: '',
		]
			.filter(Boolean)
			.join('\n'),
		fields,
	);
}

export const roomCommand = group(
	'room',
	'Create rooms and manage the accounts that belong to you.',
	[
		{
			name: 'create',
			description: 'Create a room that holds your accounts.',
			build: (sub) => {
				sub.addStringOption((option) =>
					option
						.setName('name')
						.setDescription('The name of the room')
						.setRequired(true),
				);
				sub.addStringOption((option) =>
					option
						.setName('description')
						.setDescription('What the room is for')
						.setRequired(false),
				);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const name = interaction.options.getString('name', true);
				const description =
					interaction.options.getString('description') ?? null;

				const room = await services.roomService.create(
					scope.userId,
					name,
					description,
				);

				await interaction.reply({
					embeds: [
						successEmbed(
							`The room **${room.name}** was created. It is reset automatically on **${new Date(
								room.expiresAt,
							).toUTCString()}**.\n` +
								'Add an account with `/room add`.',
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'search',
			description: 'Find your rooms by name.',
			build: (sub) => {
				sub.addStringOption((option) =>
					option
						.setName('name')
						.setDescription('Part of the room name')
						.setRequired(true)
						.setAutocomplete(true),
				);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const query = interaction.options.getString('name', true);
				const rooms = services.roomService.find(scope.userId, query);

				if (rooms.length === 0) {
					await interaction.reply({
						embeds: [
							errorEmbed(
								`No room of yours matches "${query}". Use \`/room create\` to make one.`,
							),
						],
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				// An exact match is shown with all its details.
				const exact = rooms.find(
					(room) => room.name.toLowerCase() === query.trim().toLowerCase(),
				);

				if (exact) {
					await interaction.reply({
						embeds: [roomEmbed(exact)],
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const lines = rooms
					.map(
						(room) =>
							`**${room.name}** - ${room.accounts.length} account(s) - resets ${new Date(
								room.expiresAt,
							).toUTCString()}`,
					)
					.join('\n');

				await interaction.reply({
					embeds: [
						infoEmbed('YOUR ROOMS', lines.slice(0, 4000)),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'list',
			description: 'List all rooms you own.',
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const rooms = services.roomService.list(scope.userId);

				if (rooms.length === 0) {
					await interaction.reply({
						embeds: [
							infoEmbed(
								'NO ROOMS',
								'You do not own a room yet. Create one with `/room create`.',
							),
						],
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const lines = rooms
					.map(
						(room) =>
							`**${room.name}** - ${room.accounts.length} account(s)\n` +
							`created ${room.createdAt} - resets ${new Date(
								room.expiresAt,
							).toUTCString()}`,
					)
					.join('\n\n');

				await interaction.reply({
					embeds: [infoEmbed('YOUR ROOMS', lines.slice(0, 4000))],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'add',
			description: 'Add an account (a user token) to one of your rooms.',
			build: (sub) => {
				roomNameOption(sub);
				sub.addStringOption((option) =>
					option
						.setName('token')
						.setDescription('The Discord user token of the account')
						.setRequired(true),
				);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const roomName = interaction.options.getString('room', true);
				const token = interaction.options.getString('token', true);

				const account = await services.roomService.addAccount(
					scope.userId,
					roomName,
					token,
					(raw) =>
						services.tokenService.check(raw, 'user'),
				);

				const room = services.roomService.require(
					scope.userId,
					roomName,
				);

				await interaction.reply({
					embeds: [
						successEmbed(
							`**${account.accountUsername ?? 'unknown'}** was added to **${room.name}** in slot **${account.slot}**.\n` +
								`The token is stored encrypted and shown as \`${account.masked}\`.\n` +
								'Use `/quest sessions` to see it and `/quest auto` to work with it.',
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'remove',
			description:
				'Remove an account from a room - the remaining slots are closed up.',
			build: (sub) => {
				roomNameOption(sub);
				sub.addIntegerOption((option) =>
					option
						.setName('slot')
						.setDescription('The slot of the account')
						.setRequired(true),
				);
			},
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const roomName = interaction.options.getString('room', true);
				const slot = interaction.options.getInteger('slot', true);

				const result = services.roomService.removeAccount(
					scope.userId,
					roomName,
					slot,
				);

				await interaction.reply({
					embeds: [
						successEmbed(
							`Removed **${result.removed.accountUsername ?? 'the account'}** from slot **${slot}** of **${roomName.trim()}**.\n` +
								`The slots were closed up - the next account gets slot **${result.nextSlot}**.`,
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'delete',
			description: 'Delete a room and every account in it.',
			build: roomNameOption,
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const roomName = interaction.options.getString('room', true);
				const removed = services.roomService.delete(
					scope.userId,
					roomName,
				);

				await interaction.reply({
					embeds: [
						removed
							? successEmbed(
									`The room **${roomName.trim()}** and every account in it were deleted.`,
								)
							: errorEmbed(
									`There is no room called "${roomName.trim()}".`,
								),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
		{
			name: 'renew',
			description: 'Reset the 30 day timer of a room.',
			build: roomNameOption,
			run: async (context: CommandContext) => {
				const { interaction, services, scope } = context;
				const roomName = interaction.options.getString('room', true);
				const room = services.roomService.renew(scope.userId, roomName);

				await interaction.reply({
					embeds: [
						successEmbed(
							`The room **${room.name}** now resets on **${new Date(
								room.expiresAt,
							).toUTCString()}**.`,
						),
					],
					flags: MessageFlags.Ephemeral,
				});
			},
		},
	],
);

/**
 * The rooms of a user, used by the autocomplete.
 */
export function roomAutocomplete(
	service: RoomService,
	userId: string,
	value: string,
): { name: string; value: string }[] {
	const needle = value.trim().toLowerCase();

	return service
		.list(userId)
		.filter((room) => !needle || room.name.toLowerCase().includes(needle))
		.slice(0, 25)
		.map((room) => ({
			name: room.name.slice(0, 100),
			value: room.name.slice(0, 100),
		}));
}
