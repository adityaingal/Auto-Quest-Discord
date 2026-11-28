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

const ATTACHMENT_HOSTS = new Set([
	'cdn.discordapp.com',
	'media.discordapp.net',
]);

const WEBHOOK_PATH = /^\/api\/(?:v\d+\/)?webhooks\/(\d+)\/([A-Za-z0-9_-]+)$/;
const REQUEST_TIMEOUT_MS = 10_000;

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

/** Only Discord's CDN may be used as a backup download source. */
export function verifiedAttachmentUrl(raw: string | null | undefined): string | null {
	if (!raw) return null;

	try {
		const url = new URL(raw);
		if (url.protocol !== 'https:') return null;
		return ATTACHMENT_HOSTS.has(url.hostname.toLowerCase())
			? url.toString()
			: null;
	} catch {
		return null;
	}
}

function endpoint(target: WebhookTarget): string {
	return `https://discord.com/api/webhooks/${target.id}/${target.token}`;
}

export type WebhookPayload = {
	username?: string;
	content?: string;
	embeds?: unknown[];
};

export type WebhookFilePayload = WebhookPayload & {
	filename: string;
	bytes: Uint8Array;
};

export type WebhookAttachment = {
	id: string;
	filename: string;
	size: number;
	url: string;
};

export type WebhookFileResult = {
	messageId: string;
	attachments: WebhookAttachment[];
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
		try {
			const response = await fetch(endpoint(target), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username: payload.username ?? 'Quest Completer',
					content: payload.content,
					embeds: payload.embeds,
				}),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

	/**
	 * Uploads a real file (used for SQLite snapshots). Discord only accepts
	 * multipart uploads for attachments, so this is separate from send().
	 * Only the webhook id is ever logged - never the URL or token.
	 */
	async sendFile(
		target: WebhookTarget,
		payload: WebhookFilePayload,
	): Promise<WebhookFileResult | null> {
		try {
			const form = new FormData();
			form.append(
				'payload_json',
				new Blob(
					[
						JSON.stringify({
							username: payload.username ?? 'Quest Completer',
							content: payload.content ?? null,
							embeds: payload.embeds ?? [],
						}),
					],
					{ type: 'application/json' },
				),
			);
			form.append(
				'files[0]',
				new Blob([payload.bytes], {
					type: 'application/vnd.sqlite3',
				}),
				payload.filename,
			);

			const response = await fetch(`${endpoint(target)}?wait=true`, {
				method: 'POST',
				body: form,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});

			if (!response.ok) {
				Logger.warn(
					`Webhook ${target.id} upload answered with HTTP ${response.status}`,
				);
				return null;
			}

			const message = (await response.json()) as {
				id?: string;
				attachments?: WebhookAttachment[];
			};

			if (!message.id || !message.attachments?.length) {
				Logger.warn(`Webhook ${target.id} upload had no attachment.`);
				return null;
			}

			return {
				messageId: message.id,
				attachments: message.attachments,
			};
		} catch (error) {
			Logger.warn(
				`Webhook ${target.id} upload failed: ${(error as Error).message}`,
			);
			return null;
		}
	}

	/** Reads the message metadata recorded when the snapshot was uploaded. */
	async getMessage(
		target: WebhookTarget,
		messageId: string,
	): Promise<{ id: string; embeds: unknown[]; attachments: WebhookAttachment[] } | null> {
		try {
			const response = await fetch(
				`${endpoint(target)}/messages/${encodeURIComponent(messageId)}`,
				{ signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
			);

			if (!response.ok) {
				Logger.warn(
					`Webhook ${target.id} message lookup answered with HTTP ${response.status}`,
				);
				return null;
			}

			return (await response.json()) as {
				id: string;
				embeds: unknown[];
				attachments: WebhookAttachment[];
			};
		} catch (error) {
			Logger.warn(
				`Webhook ${target.id} message lookup failed: ${(error as Error).message}`,
			);
			return null;
		}
	}

	/** Downloads a Discord CDN attachment with a hard size limit. */
	async download(url: string, maxBytes: number): Promise<Buffer | null> {
		const safe = verifiedAttachmentUrl(url);
		if (!safe) return null;

		try {
			const response = await fetch(safe, {
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});

			if (!response.ok) return null;

			const declared = Number(response.headers.get('content-length') ?? 0);
			if (declared > maxBytes) return null;

			const bytes = Buffer.from(await response.arrayBuffer());
			return bytes.length <= maxBytes ? bytes : null;
		} catch {
			return null;
		}
	}
}
