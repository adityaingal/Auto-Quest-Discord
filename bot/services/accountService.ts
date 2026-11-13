import { DiscordOAuth2, OAuth2Token } from '../integrations/oauth2';
import { Repositories } from '../database/repositories';
import { TokenVault } from '../utils/crypto';
import {
	AuthorizationError,
	NotFoundError,
	ValidationError,
} from '../utils/errors';
import { Logger } from '../utils/logger';

export type LinkStatus = {
	linked: boolean;
	discordAccountId: string | null;
	discordUsername: string | null;
	expiresAt: string | null;
	expired: boolean;
	linkedAt: string | null;
};

const SCOPES = ['identify'];

/**
 * Official OAuth2 account linking. Only OAuth2 tokens are handled - the bot
 * never asks for, stores or derives a raw user token.
 */
export class AccountService {
	constructor(
		private readonly repositories: Repositories,
		private readonly oauth2: DiscordOAuth2,
		private readonly vault: TokenVault,
	) {}

	get oauthEnabled(): boolean {
		return this.oauth2.enabled;
	}

	async beginLink(discordUserId: string): Promise<string> {
		if (!this.oauth2.enabled) {
			throw new ValidationError(
				'OAuth2 is not configured. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and DISCORD_REDIRECT_URI.',
			);
		}

		const state = this.oauth2.generateState();
		this.repositories.storeOauthState(state, discordUserId);

		return this.oauth2.buildAuthorizationUrl(state);
	}

	async completeLink(
		state: string,
		code: string,
	): Promise<{ discordUserId: string; username: string }> {
		// The state is only consumed after a successful exchange, so a failed
		// attempt (expired or already used code) can be retried with a new
		// authorisation code.
		const discordUserId = this.repositories.peekOauthState(state);
		if (!discordUserId) {
			throw new ValidationError(
				'This authorization link is invalid or expired. Run `/account link` again.',
			);
		}

		const token = await this.oauth2.exchangeCode(code);
		const identity = await this.fetchIdentity(token.access_token);

		this.repositories.consumeOauthState(state);

		this.repositories.linkAccount({
			discord_user_id: discordUserId,
			discord_account_id: identity.id,
			discord_username: identity.username,
			access_token: this.vault.encrypt(token.access_token),
			refresh_token: token.refresh_token
				? this.vault.encrypt(token.refresh_token)
				: null,
			expires_at: new Date(
				Date.now() + token.expires_in * 1000,
			).toISOString(),
			scopes: token.scope ?? SCOPES.join(' '),
		});

		Logger.info(`Linked Discord account ${identity.username} for ${discordUserId}`);

		return { discordUserId, username: identity.username };
	}

	private async fetchIdentity(
		accessToken: string,
	): Promise<{ id: string; username: string }> {
		const response = await fetch(
			'https://discord.com/api/v10/users/@me',
			{ headers: { Authorization: accessToken } },
		);

		if (!response.ok) {
			throw new ValidationError(
				`Discord rejected the authorization (HTTP ${response.status}).`,
			);
		}

		const body = (await response.json()) as { id: string; username: string };
		return { id: body.id, username: body.username };
	}

	status(discordUserId: string): LinkStatus {
		const link = this.repositories.getLink(discordUserId);

		if (!link) {
			return {
				linked: false,
				discordAccountId: null,
				discordUsername: null,
				expiresAt: null,
				expired: false,
				linkedAt: null,
			};
		}

		const expired = link.expires_at
			? new Date(link.expires_at).getTime() <= Date.now()
			: false;

		return {
			linked: true,
			discordAccountId: link.discord_account_id,
			discordUsername: link.discord_username,
			expiresAt: link.expires_at,
			expired,
			linkedAt: link.linked_at,
		};
	}

	unlink(discordUserId: string): number {
		return this.repositories.unlinkAll(discordUserId);
	}

	/**
	 * Returns a usable access token, refreshing it when needed.
	 */
	async resolveAccessToken(
		discordUserId: string,
	): Promise<string | null> {
		const link = this.repositories.getLink(discordUserId);
		if (!link || !link.access_token) return null;

		const expired = link.expires_at
			? new Date(link.expires_at).getTime() <= Date.now() + 30_000
			: false;

		if (!expired) {
			try {
				return this.vault.decrypt(link.access_token);
			} catch {
				this.repositories.markLinkStatus(link.id, 'expired');
				return null;
			}
		}

		if (!link.refresh_token) {
			this.repositories.markLinkStatus(link.id, 'expired');
			throw new AuthorizationError(
				'The linked authorization expired and cannot be refreshed.',
			);
		}

		let refreshed: OAuth2Token;
		try {
			refreshed = await this.oauth2.refresh(
				this.vault.decrypt(link.refresh_token),
			);
		} catch {
			this.repositories.markLinkStatus(link.id, 'revoked');
			throw new AuthorizationError(
				'The linked authorization was revoked by Discord.',
			);
		}

		this.repositories.linkAccount({
			discord_user_id: link.discord_user_id,
			discord_account_id: link.discord_account_id,
			discord_username: link.discord_username,
			access_token: this.vault.encrypt(refreshed.access_token),
			refresh_token: refreshed.refresh_token
				? this.vault.encrypt(refreshed.refresh_token)
				: link.refresh_token,
			expires_at: new Date(
				Date.now() + refreshed.expires_in * 1000,
			).toISOString(),
			scopes: refreshed.scope ?? link.scopes,
		});

		return refreshed.access_token;
	}

	privacyNotice(): string[] {
		return [
			'**What is stored**',
			'• Your Discord user id (the one that runs the command).',
			'• The linked account id and username of the account you authorise.',
			'• An encrypted OAuth2 access token and refresh token (AES-256-GCM).',
			'• Quest progress, reward status and command history for your account.',
			'',
			'**What is never stored**',
			'• Your Discord password.',
			'• Raw user tokens - the bot never asks for one.',
			'• Message content of other users.',
			'',
			'**Who can see it**',
			'• Only you. Account data is never shown to other members.',
			'• The bot owner can see aggregate statistics (counts only, never tokens).',
			'',
			'**How to remove it**',
			'• `/account unlink` deletes the stored tokens and the link immediately.',
			'• The owner can purge a user entry with `/admin maintenance purge user:<id>`.',
		];
	}

	async requireLink(discordUserId: string): Promise<void> {
		const status = this.status(discordUserId);
		if (!status.linked) {
			throw new NotFoundError(
				'No account is linked yet. Use `/account link` to connect one.',
			);
		}
	}
}
