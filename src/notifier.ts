import { REST } from '@discordjs/rest';

const MAX_LENGTH = 1900;

export type NotifierOptions = {
	/** Overrides NOTIFY_CHANNEL_ID for this account. */
	channelId?: string;
	/** Overrides BOT_TOKEN for this account. */
	botToken?: string;
	/** Prefix added to every message, e.g. "[main]". */
	label?: string;
};

/**
 * Posts status messages to a Discord channel with a separate bot account.
 *
 * The bot token is only used for notifications - the quests themselves are
 * always completed with the user token, because quests are a user feature.
 */
export class Notifier {
	private readonly rest: REST | null = null;
	private readonly channelId: string | null;
	private readonly label: string;

	constructor(options: NotifierOptions = {}) {
		const token =
			options.botToken?.trim() ?? process.env.BOT_TOKEN?.trim();
		const channelId =
			options.channelId?.trim() ?? process.env.NOTIFY_CHANNEL_ID?.trim();

		this.channelId = channelId ?? null;
		this.label = options.label ? `${options.label} ` : '';

		if (token && channelId) {
			this.rest = new REST({ version: '10' }).setToken(token);
		} else if (token) {
			console.warn(
				'⚠ BOT_TOKEN is set but NOTIFY_CHANNEL_ID is missing - notifications are disabled.',
			);
		}
	}

	get enabled(): boolean {
		return this.rest !== null && this.channelId !== null;
	}

	async send(content: string): Promise<void> {
		if (!this.rest || !this.channelId) return;

		const message = `${this.label}${content}`;
		const body =
			message.length > MAX_LENGTH
				? `${message.slice(0, MAX_LENGTH)}…`
				: message;

		try {
			await this.rest.post(`/channels/${this.channelId}/messages`, {
				body: { content: body },
			});
		} catch (error) {
			const status = (error as { status?: number })?.status;
			const reason = (error as { message?: string })?.message ?? 'unknown';

			if (status === 401 || status === 403) {
				console.error(
					`⚠ Notification failed (${status}). Check the bot token, its permissions and the channel id.`,
				);
			} else {
				console.error(`⚠ Notification failed: ${reason}`);
			}
		}
	}
}
