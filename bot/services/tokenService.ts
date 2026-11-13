import { createHash } from 'node:crypto';
import { Repositories } from '../database/repositories';
import { TokenVault } from '../utils/crypto';
import { Logger } from '../utils/logger';
import { NotFoundError, ValidationError } from '../utils/errors';

export type TokenType = 'bot' | 'user';

export type TokenRecord = {
	id: number;
	label: string;
	type: TokenType;
	applicationId: string | null;
	botUserId: string | null;
	botUsername: string | null;
	accountId: string | null;
	accountUsername: string | null;
	status: string;
	createdAt: string;
	lastCheckedAt: string | null;
	/** Masked token - the plain value is never returned or logged. */
	masked: string;
	/** Short fingerprint so two tokens can be told apart. */
	fingerprint: string;
};

export type TokenCheck = {
	valid: boolean;
	username: string | null;
	id: string | null;
	message: string;
};

/**
 * Manages bot tokens and (optionally) user tokens.
 *
 * Bot tokens are the official way to authenticate a Discord bot. User tokens
 * are only accepted when the operator explicitly asks for them, they are
 * stored encrypted like every other credential, and they are only used for
 * the quest endpoints that Discord exposes to a signed-in user.
 */
export class TokenService {
	constructor(
		private readonly repositories: Repositories,
		private readonly vault: TokenVault,
	) {}

	static mask(token: string): string {
		if (token.length <= 12) return '***';
		return `${token.slice(0, 6)}...${token.slice(-4)}`;
	}

	static fingerprint(token: string): string {
		return createHash('sha256')
			.update(token)
			.digest('hex')
			.slice(0, 8);
	}

	/**
	 * A bot token encodes the placeholder id 123456789012345678 in its first
	 * segment, a user token encodes the real account id.
	 */
	static looksLikeUserToken(token: string): boolean {
		const first = token.split('.')[0];
		if (!first || first.length < 20) return false;

		try {
			const decoded = Buffer.from(first, 'base64').toString('utf8');
			if (decoded === '123456789012345678') return false;

			return /^\d{15,20}$/.test(decoded);
		} catch {
			return false;
		}
	}

	static normalize(token: string): string {
		let value = token.trim().replace(/^["']|["']$/g, '');

		if (value.toLowerCase().startsWith('bot ')) {
			value = value.slice(4).trim();
		}

		return value;
	}

	/**
	 * Validates a token against Discord.
	 */
	async check(
		rawToken: string,
		expected: TokenType = 'bot',
	): Promise<TokenCheck> {
		const token = TokenService.normalize(rawToken);

		if (!token || token.length < 30) {
			return {
				valid: false,
				username: null,
				id: null,
				message: 'That does not look like a Discord token.',
			};
		}

		const looksLikeUser = TokenService.looksLikeUserToken(token);

		if (expected === 'bot' && looksLikeUser) {
			return {
				valid: false,
				username: null,
				id: null,
				message:
					'That is a **user token** (it starts with an account id). ' +
					'Use `/token add` with type **user** to register it, or `/account link` for the OAuth2 flow.',
			};
		}

		if (expected === 'user' && !looksLikeUser) {
			return {
				valid: false,
				username: null,
				id: null,
				message:
					'That does not look like a user token. A user token starts with the base64 encoded account id.',
			};
		}

		try {
			const response = await fetch(
				'https://discord.com/api/v10/users/@me',
				{
					headers: {
						Authorization: expected === 'bot' ? `Bot ${token}` : token,
						'User-Agent':
							'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9215 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36',
					},
				},
			);

			if (!response.ok) {
				return {
					valid: false,
					username: null,
					id: null,
					message:
						response.status === 401
							? 'Discord rejected this token (HTTP 401). It was probably reset or copied incompletely.'
							: `Discord rejected the token (HTTP ${response.status}).`,
				};
			}

			const body = (await response.json()) as {
				id: string;
				username: string;
				bot?: boolean;
			};

			if (expected === 'bot' && !body.bot) {
				return {
					valid: false,
					username: null,
					id: null,
					message:
						'That is a user account token. Use the type **user** to register it.',
				};
			}

			if (expected === 'user' && body.bot) {
				return {
					valid: false,
					username: null,
					id: null,
					message:
						'That is a bot token. Use the type **bot** to register it.',
				};
			}

			return {
				valid: true,
				username: body.username,
				id: body.id,
				message: `Valid ${expected} token for ${body.username} (${body.id}).`,
			};
		} catch (error) {
			return {
				valid: false,
				username: null,
				id: null,
				message: `Could not reach Discord: ${(error as Error).message}`,
			};
		}
	}

	async add(
		label: string,
		rawToken: string,
		type: TokenType = 'bot',
	): Promise<TokenRecord> {
		const cleanLabel = label.trim();
		if (!cleanLabel) {
			throw new ValidationError('Give the token a label.');
		}

		const token = TokenService.normalize(rawToken);
		const check = await this.check(token, type);

		if (!check.valid) {
			throw new ValidationError(check.message);
		}

		const applicationId =
			type === 'bot' ? await this.fetchApplicationId(token) : null;

		this.repositories.addBotToken({
			label: cleanLabel,
			token: this.vault.encrypt(token),
			type,
			application_id: applicationId,
			bot_user_id: type === 'bot' ? check.id : null,
			bot_username: type === 'bot' ? check.username : null,
			account_id: type === 'user' ? check.id : null,
			account_username: type === 'user' ? check.username : null,
		});

		Logger.info(
			`${type} token "${cleanLabel}" registered for ${check.username}`,
		);

		return this.findByLabel(cleanLabel);
	}

	private async fetchApplicationId(
		token: string,
	): Promise<string | null> {
		try {
			const response = await fetch(
				'https://discord.com/api/v10/oauth2/applications/@me',
				{ headers: { Authorization: `Bot ${token}` } },
			);

			if (!response.ok) return null;

			const body = (await response.json()) as { id?: string };
			return body.id ?? null;
		} catch {
			return null;
		}
	}

	list(): TokenRecord[] {
		return this.repositories
			.listBotTokens()
			.map((row) => this.toRecord(row));
	}

	private toRecord(row: {
		id: number;
		label: string;
		token: string;
		type: 'bot' | 'user';
		application_id: string | null;
		bot_user_id: string | null;
		bot_username: string | null;
		account_id: string | null;
		account_username: string | null;
		status: string;
		created_at: string;
		last_checked_at: string | null;
	}): TokenRecord {
		let plain = '';
		try {
			plain = this.vault.decrypt(row.token);
		} catch {
			plain = '';
		}

		return {
			id: row.id,
			label: row.label,
			type: row.type,
			applicationId: row.application_id,
			botUserId: row.bot_user_id,
			botUsername: row.bot_username,
			accountId: row.account_id,
			accountUsername: row.account_username,
			status: row.status,
			createdAt: row.created_at,
			lastCheckedAt: row.last_checked_at,
			masked: TokenService.mask(plain),
			fingerprint: TokenService.fingerprint(plain),
		};
	}

	findByLabel(label: string): TokenRecord {
		const row = this.repositories
			.listBotTokens()
			.find((entry) => entry.label === label);

		if (!row) {
			throw new NotFoundError(`No token with the label "${label}".`);
		}

		return this.toRecord(row);
	}

	remove(id: number): boolean {
		const removed = this.repositories.deleteBotToken(id);
		if (removed > 0) Logger.info(`Token #${id} removed`);

		return removed > 0;
	}

	async revalidate(id: number): Promise<TokenCheck> {
		const row = this.repositories.getBotToken(id);
		if (!row) {
			throw new NotFoundError(`No token with the id ${id}.`);
		}

		let plain = '';
		try {
			plain = this.vault.decrypt(row.token);
		} catch {
			this.repositories.touchBotToken(id, 'unreadable');
			return {
				valid: false,
				username: null,
				id: null,
				message:
					'The stored token could not be decrypted - the ENCRYPTION_KEY probably changed.',
			};
		}

		const check = await this.check(plain, row.type);
		this.repositories.touchBotToken(id, check.valid ? 'active' : 'invalid');

		return check;
	}

	/**
	 * All usable bot tokens - used to start additional bot instances.
	 */
	resolveUsable(): { label: string; token: string }[] {
		return this.resolveByType('bot');
	}

	/**
	 * All usable user tokens - used for the quest automation.
	 */
	resolveUserSessions(): { label: string; token: string }[] {
		return this.resolveByType('user');
	}

	private resolveByType(type: TokenType): { label: string; token: string }[] {
		const usable: { label: string; token: string }[] = [];

		for (const row of this.repositories.listBotTokens()) {
			if (row.type !== type || row.status === 'invalid') continue;

			try {
				usable.push({
					label: row.label,
					token: this.vault.decrypt(row.token),
				});
			} catch {
				this.repositories.touchBotToken(row.id, 'unreadable');
			}
		}

		return usable;
	}
}
