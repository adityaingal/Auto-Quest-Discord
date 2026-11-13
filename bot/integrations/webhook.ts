import { Logger } from '../utils/logger';

/**
 * A Discord outgoing webhook. Only Discord's own webhook endpoints are
 * accepted - the bot must not become a general purpose HTTP client that
 * posts to arbitrary addresses.
 */
const ALLOWED_HOSTS = new Set([
	'discord.com',
	'www.discord.com',
	'discordapp.com',
	'canary.discord.com',
	'ptb.discord.com',
]);

const WEBHOOK_PATH = /^\/api\/(?:v\d+\/)?webhooks\/(\d+)\/([A-Za-z0-9_-]+)$/;

export type WebhookTarget = {
	/** The webhook id - safe to show. */
	id: string;
	/** The webhook token - a credential, never shown in full. */
	token: string;
};

/**
 * Splits a webhook URL into its id and its token. Returns null when the URL
 * is not a Discord webhook.
 */
export function parseWebhookUrl(raw: string): WebhookTarget | null {
	let url: URL;

	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}

	if (url.protocol !== 'https:') return null;
	if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;

	const match = WEBHOOK_PATH.exec(url.pathname);
	if (!match) return null;

	return { id: match[1], token: match[2] };
}

export type WebhookPayload = {
	username?: string;
	content?: string;
	embeds?: unknown[];
};

/**
 * Posts to a Discord webhook. Failures are logged and swallowed - a broken
 * webhook must never break the command that triggered it.
 */
export class DiscordWebhook {
	async send(
		target: WebhookTarget,
		payload: WebhookPayload,
	): Promise<boolean> {
		const url = `https://discord.com/api/webhooks/${target.id}/${target.token}`;

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username: payload.username ?? 'Quest Completer',
					content: payload.content,
					embeds: payload.embeds,
				}),
			});

			if (!response.ok) {
				Logger.warn(
					`Webhook ${target.id} answered with HTTP ${response.status}`,
				);
				return false;
			}

			return true;
		} catch (error) {
			Logger.warn(
				`Webhook ${target.id} could not be reached: ${
					(error as Error).message
				}`,
			);
			return false;
		}
	}
}
