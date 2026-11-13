import { Repositories, RoomAccountRow, RoomRow } from '../database/repositories';
import { TokenVault } from '../utils/crypto';
import { Logger } from '../utils/logger';
import {
	NotFoundError,
	ValidationError,
} from '../utils/errors';
import { DiscordWebhook, WebhookTarget } from '../integrations/webhook';
import { UserSession } from '../integrations/userSession';
import { COLORS, EMOJI } from '../ui/theme';

/** A room is reset automatically after this many days. */
export const ROOM_LIFETIME_DAYS = 30;

/** How many rooms one user may own at the same time. */
export const MAX_ROOMS_PER_USER = 10;

/** How many accounts one room may hold. */
export const MAX_ACCOUNTS_PER_ROOM = 25;

/** The name of a room - it is shown in the Discord interface. */
const ROOM_NAME = /^[\w][\w .()-]{0,39}$/;

export type RoomAccount = {
	id: number;
	slot: number;
	accountId: string | null;
	accountUsername: string | null;
	status: string;
	createdAt: string;
	/** Masked token - the plain value is never returned. */
	masked: string;
};

export type Room = {
	id: number;
	name: string;
	description: string | null;
	ownerUserId: string;
	createdAt: string;
	updatedAt: string;
	expiresAt: string;
	/** True when the room is past its 30 day lifetime. */
	expired: boolean;
	accounts: RoomAccount[];
};

export type RoomEvent =
	| 'room_created'
	| 'account_added'
	| 'account_removed';

/**
 * The rooms of the users.
 *
 * A room belongs to exactly one Discord user and holds the accounts (user
 * tokens) that user wants to work with. Nobody else can see it: every read
 * and every write is scoped by the owner id.
 *
 * The slots of a room are the sequence 1, 2, 3, ... - when an account is
 * removed the remaining ones move up, so the next account continues the
 * sequence instead of leaving a hole behind.
 */
export class RoomService {

	constructor(
		private readonly repositories: Repositories,
		private readonly vault: TokenVault,
		private readonly webhook: DiscordWebhook = new DiscordWebhook(),
		private readonly target: WebhookTarget | null = null,
	) {}

	// ------------------------------------------------------------- rooms

	private static expiryFromNow(): string {
		return new Date(
			Date.now() + ROOM_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
		).toISOString();
	}

	/**
	 * Creates a room for a user. The name is unique per user, so two people
	 * can use the same name without seeing each other's room.
	 */
	async create(
		ownerUserId: string,
		name: string,
		description?: string | null,
	): Promise<Room> {
		const cleanName = name.trim();

		if (!ROOM_NAME.test(cleanName)) {
			throw new ValidationError(
				'A room name may only contain letters, numbers, spaces and . _ - ( ) and has to start with a letter or number.',
			);
		}

		if (this.repositories.getRoom(ownerUserId, cleanName)) {
			throw new ValidationError(
				`You already have a room called "${cleanName}".`,
			);
		}

		const rooms = this.repositories.listRooms(ownerUserId);
		if (rooms.length >= MAX_ROOMS_PER_USER) {
			throw new ValidationError(
				`You can own at most ${MAX_ROOMS_PER_USER} rooms. Delete one with \`/room delete\` first.`,
			);
		}

		const id = this.repositories.createRoom({
			owner_user_id: ownerUserId,
			name: cleanName,
			description: description?.trim() || null,
			expires_at: RoomService.expiryFromNow(),
		});

		Logger.info(`Room "${cleanName}" created for ${ownerUserId}`);

		const room = this.require(ownerUserId, cleanName);
		await this.notify(room, 'room_created');

		return room;
	}

	/** Reads a room. Only the owner gets it. */
	require(ownerUserId: string, name: string): Room {
		const row = this.repositories.getRoom(ownerUserId, name.trim());

		if (!row) {
			throw new NotFoundError(
				`There is no room called "${name.trim()}" - create it with \`/room create\`.`,
			);
		}

		return this.toRoom(row);
	}

	/** Finds a room by name, searching case insensitively. */
	find(ownerUserId: string, query: string): Room[] {
		const needle = query.trim().toLowerCase();

		return this.repositories
			.listRooms(ownerUserId)
			.filter(
				(row) =>
					needle.length === 0 ||
					row.name.toLowerCase().includes(needle) ||
					(row.description ?? '').toLowerCase().includes(needle),
			)
			.map((row) => this.toRoom(row));
	}

	list(ownerUserId: string): Room[] {
		return this.repositories
			.listRooms(ownerUserId)
			.map((row) => this.toRoom(row));
	}

	delete(ownerUserId: string, name: string): boolean {
		const room = this.repositories.getRoom(ownerUserId, name.trim());

		if (!room) return false;

		this.repositories.deleteRoom(room.id);
		Logger.info(`Room "${room.name}" of ${ownerUserId} deleted`);

		return true;
	}

	/** Extends the lifetime of a room by the full 30 days. */
	renew(ownerUserId: string, name: string): Room {
		const room = this.repositories.getRoom(ownerUserId, name.trim());

		if (!room) {
			throw new NotFoundError(
				`There is no room called "${name.trim()}".`,
			);
		}

		this.repositories.updateRoom(room.id, {
			expires_at: RoomService.expiryFromNow(),
		});

		return this.require(ownerUserId, room.name);
	}

	// ---------------------------------------------------------- accounts

	/**
	 * Puts an account into a room. The token is validated against Discord
	 * before it is stored, and it is encrypted at rest.
	 */
	async addAccount(
		ownerUserId: string,
		roomName: string,
		rawToken: string,
		validate: (
			token: string,
		) => Promise<{ valid: boolean; id: string | null; username: string | null; message: string }>,
	): Promise<RoomAccount> {
		const room = this.require(ownerUserId, roomName);

		if (room.accounts.length >= MAX_ACCOUNTS_PER_ROOM) {
			throw new ValidationError(
				`A room holds at most ${MAX_ACCOUNTS_PER_ROOM} accounts.`,
			);
		}

		const token = rawToken.trim().replace(/^["']|["']$/g, '');
		const check = await validate(token);

		if (!check.valid) {
			throw new ValidationError(check.message);
		}

		const slot = this.repositories.nextRoomSlot(room.id);

		this.repositories.addRoomAccount({
			room_id: room.id,
			slot,
			token: this.vault.encrypt(token),
			account_id: check.id,
			account_username: check.username,
		});

		Logger.info(
			`Account ${check.username ?? 'unknown'} added to room "${room.name}" (slot ${slot})`,
		);

		const account = this.repositories.getRoomAccount(room.id, slot);
		if (!account) {
			throw new ValidationError('The account could not be stored.');
		}

		const record = this.toAccount(account);
		await this.notify(room, 'account_added', record);

		return record;
	}

	/**
	 * Removes an account and closes the gap, so the slots stay a continuous
	 * sequence and the next account continues where this one ended.
	 */
	removeAccount(
		ownerUserId: string,
		roomName: string,
		slot: number,
	): { removed: RoomAccount; nextSlot: number; room: Room } {
		const room = this.require(ownerUserId, roomName);
		const account = this.repositories.getRoomAccount(room.id, slot);

		if (!account) {
			throw new NotFoundError(
				`There is no account in slot ${slot} of "${room.name}".`,
			);
		}

		this.repositories.deleteRoomAccount(room.id, slot);
		Logger.info(
			`Slot ${slot} removed from room "${room.name}" - the sequence was closed`,
		);

		const removed = this.toAccount(account);
		const updated = this.require(ownerUserId, room.name);
		void this.notify(updated, 'account_removed', removed);

		return {
			removed,
			nextSlot: this.repositories.nextRoomSlot(room.id),
			room: updated,
		};
	}

	// ------------------------------------------------------------ webhook

	/**
	 * True when the developer guild webhook is configured. All room events
	 * are mirrored there.
	 */
	get webhookConfigured(): boolean {
		return this.target !== null;
	}

	/**
	 * Posts an event of a room to the developer guild webhook. The token is
	 * never sent - only the room name, the account and the event type.
	 */
	async notify(
		room: Room,
		event: RoomEvent,
		account?: RoomAccount,
	): Promise<boolean> {
		if (!this.target) return false;

		const lines: string[] = [];

		if (event === 'room_created') {
			lines.push(`**Room created:** ${room.name}`);
		}

		if (event === 'account_added' && account) {
			lines.push(
				`**Account added:** ${account.accountUsername ?? 'unknown'} in room ${room.name} (slot ${account.slot})`,
			);
		}

		if (event === 'account_removed' && account) {
			lines.push(
				`**Account removed:** ${account.accountUsername ?? 'unknown'} from room ${room.name} (slot ${account.slot})`,
			);
		}

		if (!lines.length) return false;

		const fields: { name: string; value: string; inline: boolean }[] = [
			{
				name: 'Room',
				value: room.name,
				inline: true,
			},
			{
				name: 'Event',
				value: event.replace(/_/g, ' '),
				inline: true,
			},
		];

		if (account) {
			fields.push({
				name: 'Account',
				value: `${account.accountUsername ?? 'unknown'}\n\`${
					account.accountId ?? '?'
				}\``,
				inline: false,
			});
		}

		return this.webhook.send(this.target, {
			username: 'Quest Completer',
			embeds: [
				{
					color: COLORS.primary,
					title: `${EMOJI.available} ROOM UPDATE`,
					description: lines.join('\n'),
					fields,
					timestamp: new Date().toISOString(),
				},
			],
		});
	}

	// ------------------------------------------------------------ expiry

	/**
	 * Deletes every room that is past its 30 day lifetime and reports which
	 * owners were affected, so they can be told about it.
	 */
	sweepExpired(now = new Date().toISOString()): {
		ownerUserId: string;
		name: string;
	}[] {
		const expired = this.repositories.listExpiredRooms(now);
		const affected: { ownerUserId: string; name: string }[] = [];

		for (const room of expired) {
			this.repositories.deleteRoom(room.id);
			affected.push({ ownerUserId: room.owner_user_id, name: room.name });
			Logger.info(
				`Room "${room.name}" of ${room.owner_user_id} expired and was reset`,
			);
		}

		return affected;
	}

	/**
	 * Resets the rooms that are past their 30 day lifetime and tells their
	 * owners about it. A room that is about to expire is warned about first.
	 */
	async runExpirySweep(
		send: (userId: string, message: string) => Promise<void>,
	): Promise<number> {
		// The warning goes out a few days before the reset.
		for (const room of this.roomsExpiringSoon(3)) {
			await send(
				room.ownerUserId,
				`⏳ Your room **${room.name}** is reset on ${new Date(
					room.expiresAt,
				).toUTCString()}. Use \`/room renew\` to keep it.`,
			).catch(() => undefined);
		}

		const expired = this.sweepExpired();

		for (const room of expired) {
			await send(
				room.ownerUserId,
				`🧹 Your room **${room.name}** reached its 30 day limit and was reset. ` +
					'Every account in it was deleted. Create a new room with `/room create`.',
			).catch(() => undefined);
		}

		return expired.length;
	}

	/**
	 * The rooms that expire in the next few days - the owner gets a warning
	 * before the room is reset.
	 */
	roomsExpiringSoon(
		withinDays = 3,
		now = new Date().toISOString(),
	): { ownerUserId: string; name: string; expiresAt: string }[] {
		const until = new Date(
			Date.now() + withinDays * 24 * 60 * 60 * 1000,
		).toISOString();

		return this.repositories.listExpiringRooms(now, until).map((room) => ({
			ownerUserId: room.owner_user_id,
			name: room.name,
			expiresAt: room.expires_at,
		}));
	}

	// ---------------------------------------------------------- sessions

	/**
	 * The accounts of every room of one owner, with their decrypted token.
	 * The label is "<room>:<slot>", so two accounts of two rooms never share
	 * a label.
	 *
	 * The caller turns the token into a session - it can cache that, so the
	 * token is not decrypted again for every single request.
	 */
	accountsWithTokens(ownerUserId: string): {
		label: string;
		token: string;
	}[] {
		const accounts: { label: string; token: string }[] = [];

		for (const room of this.repositories.listRooms(ownerUserId)) {
			for (const account of this.repositories.listRoomAccounts(
				room.id,
			)) {
				let plain = '';

				try {
					plain = this.vault.decrypt(account.token);
				} catch {
					continue;
				}

				accounts.push({
					label: `${room.name}:${account.slot}`,
					token: plain,
				});
			}
		}

		return accounts;
	}

	/**
	 * The user sessions of one owner. Every account of every room of that
	 * user is returned - the label is "<room>:<slot>", so two accounts of
	 * two rooms never share a label.
	 */
	sessionsFor(ownerUserId: string): {
		label: string;
		session: UserSession;
	}[] {
		return this.accountsWithTokens(ownerUserId).map((entry) => ({
			label: entry.label,
			session: new UserSession(entry.token),
		}));
	}

	// ------------------------------------------------------------ mapper

	private toAccount(row: RoomAccountRow): RoomAccount {
		let plain = '';

		try {
			plain = this.vault.decrypt(row.token);
		} catch {
			plain = '';
		}

		return {
			id: row.id,
			slot: row.slot,
			accountId: row.account_id,
			accountUsername: row.account_username,
			status: row.status,
			createdAt: row.created_at,
			masked: plain.length > 12
				? `${plain.slice(0, 6)}...${plain.slice(-4)}`
				: '***',
		};
	}

	private toRoom(row: RoomRow): Room {
		return {
			id: row.id,
			name: row.name,
			description: row.description,
			ownerUserId: row.owner_user_id,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			expiresAt: row.expires_at,
			expired:
				new Date(row.expires_at).getTime() <= Date.now(),
			accounts: this.repositories
				.listRoomAccounts(row.id)
				.map((account) => this.toAccount(account)),
		};
	}
}
