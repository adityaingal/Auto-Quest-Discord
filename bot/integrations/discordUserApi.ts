import { REST } from 'discord.js';

export type ApiResult<T> = {
	ok: boolean;
	status: number;
	data: T | null;
	error: string | null;
};

/**
 * Thin wrapper around Discord's REST API for calls that use a *linked user*
 * OAuth2 token. The bot token is never used for user scoped endpoints and
 * authorization headers are never logged.
 */
export class DiscordUserApi {
	constructor(private readonly accessToken: string) {}

	private get rest(): REST {
		return new REST({ version: '10' }).setToken(this.accessToken);
	}

	async get<T>(route: string): Promise<ApiResult<T>> {
		try {
			const data = await this.rest.get(
				route as `/${string}`,
			) as T;
			return { ok: true, status: 200, data, error: null };
		} catch (error) {
			const status =
				(error as { status?: number })?.status ?? 0;
			const message =
				(error as { message?: string })?.message ?? 'Request failed';

			return { ok: false, status, data: null, error: message };
		}
	}
}
