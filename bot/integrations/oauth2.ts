import { randomBytes } from 'node:crypto';
import { Logger } from '../utils/logger';

export type OAuth2Config = {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	scopes: string[];
};

export type OAuth2Token = {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token?: string;
	scope?: string;
};

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/v10/oauth2/token';

/**
 * Discord answers with an empty body for most token errors, so the status
 * code is all we have to work with.
 */
function describeExchangeFailure(
	status: number,
	details: string,
): string {
	if (details) {
		try {
			const parsed = JSON.parse(details) as {
				error?: string;
				error_description?: string;
			};

			if (parsed.error === 'invalid_grant') {
				return (
					'Discord refused the authorization code (invalid_grant). ' +
					'That happens when the code was already used, when it is older than a few minutes, ' +
					'when the redirect URI differs from the one the code was issued for, ' +
					'or when the code was issued for a different client id.\n' +
					'Run `/account link` again, click the Authorise button once and do not reload the page afterwards.'
				);
			}

			if (parsed.error === 'invalid_client') {
				return (
					'Discord rejected the client credentials (invalid_client). ' +
					'Check DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.'
				);
			}

			if (parsed.error_description?.includes('redirect_uri')) {
				return (
					'Discord refused the redirect URI. ' +
					`DISCORD_REDIRECT_URI must match the redirect registered in the Developer Portal exactly (currently "${parsed.error_description}").`
				);
			}

			if (parsed.error_description) {
				return `Discord refused the token exchange: ${parsed.error_description}`;
			}
		} catch {
			// not JSON - fall through to the raw details
		}

		return `Discord refused the token exchange (HTTP ${status}): ${details}`;
	}

	if (status === 400) {
		return (
			'Discord refused the authorization code (HTTP 400). ' +
			'An authorization code can only be used once and expires after a few minutes - ' +
			'this happens when the callback page is reloaded or the link is opened twice. ' +
			'Run `/account link` again for a fresh code.'
		);
	}

	if (status === 401) {
		return (
			'Discord rejected the client credentials (HTTP 401). ' +
			'Check DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.'
		);
	}

	return `Discord refused the token exchange (HTTP ${status}).`;
}

/**
 * Official Discord OAuth2 authorization-code flow. Only OAuth2 tokens are
 * handled here - never a raw user token.
 */
export class DiscordOAuth2 {
	constructor(private readonly config: OAuth2Config) {}

	get enabled(): boolean {
		return Boolean(
			this.config.clientSecret && this.config.redirectUri,
		);
	}

	buildAuthorizationUrl(state: string): string {
		const url = new URL(AUTHORIZE_URL);
		url.searchParams.set('client_id', this.config.clientId);
		url.searchParams.set('redirect_uri', this.config.redirectUri);
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('scope', this.config.scopes.join(' '));
		url.searchParams.set('state', state);
		url.searchParams.set('prompt', 'consent');
		return url.toString();
	}

	generateState(): string {
		return randomBytes(24).toString('hex');
	}

	async exchangeCode(code: string): Promise<OAuth2Token> {
		const body = new URLSearchParams({
			client_id: this.config.clientId,
			client_secret: this.config.clientSecret,
			grant_type: 'authorization_code',
			code,
			redirect_uri: this.config.redirectUri,
		});

		const response = await fetch(TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
		});

		if (!response.ok) {
			const details = (await response.text()).trim();

			// The client id and the redirect uri are no secrets - they make a
			// failed exchange much easier to diagnose.
			Logger.warn(
				`Token exchange failed (${response.status}) - client_id=${this.config.clientId} redirect_uri=${this.config.redirectUri}`,
			);

			throw new Error(
				describeExchangeFailure(response.status, details),
			);
		}

		return (await response.json()) as OAuth2Token;
	}

	async refresh(refreshToken: string): Promise<OAuth2Token> {
		const body = new URLSearchParams({
			client_id: this.config.clientId,
			client_secret: this.config.clientSecret,
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
		});

		const response = await fetch(TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
		});

		if (!response.ok) {
			throw new Error(
				`OAuth2 refresh failed (${response.status}): ${await response.text()}`,
			);
		}

		return (await response.json()) as OAuth2Token;
	}
}
