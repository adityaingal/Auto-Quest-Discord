/**
 * Optional user-session client.
 *
 * Discord's quest endpoints are user-session endpoints: they only answer a
 * signed-in user token. This module is the single place in the whole bot that
 * touches such a token, and it is completely optional - without USER_TOKEN in
 * the environment the bot works purely with the catalogue and OAuth2.
 *
 * The token is read from the environment only. It is never requested through
 * a command, never written to the database and never logged.
 *
 * Note: automating a user session violates Discord's terms of service. Use it
 * at your own risk.
 */

export const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9215 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36';

export const SUPER_PROPERTIES = {
	os: 'Windows',
	browser: 'Discord Client',
	release_channel: 'stable',
	client_version: '1.0.9215',
	os_version: '10.0.19045',
	os_arch: 'x64',
	app_arch: 'x64',
	system_locale: 'en-US',
	has_client_mods: false,
	client_launch_id: '00000000-0000-4000-8000-000000000000',
	browser_user_agent: USER_AGENT,
	browser_version: '37.6.0',
	os_sdk_version: '19045',
	client_build_number: 471091,
	native_build_number: 72186,
	client_event_source: null,
	launch_signature: '00000000-0000-4000-8000-000000000000',
	client_heartbeat_session_id: '00000000-0000-4000-8000-000000000000',
	client_app_state: 'focused',
};

export type QuestPayload = {
	id: string;
	config: {
		messages: { quest_name: string };
		application: { id: string; name: string };
		task_config?: { tasks?: Record<string, { target: number }> };
		task_config_v2?: { tasks?: Record<string, { target: number }> };
		rewards_config?: {
			rewards: { messages: { name: string }; orb_quantity?: number }[];
			platforms?: number[];
		};
		expires_at: string;
	};
	user_status: {
		enrolled_at: string | null;
		completed_at: string | null;
		claimed_at: string | null;
		progress: Record<string, { value: number }>;
	} | null;
};

export type UserSessionResult<T> = {
	ok: boolean;
	status: number;
	data: T | null;
	error: string | null;
};

/**
 * A user-session REST client. It sends the desktop client fingerprint and
 * drops the "Bot " prefix that discord.js adds by default.
 */
export class UserSession {
	constructor(private readonly token: string) {}

	static fromEnvironment(): UserSession | null {
		const token = process.env.USER_TOKEN?.trim();
		if (!token) return null;

		return new UserSession(token);
	}

	private async request<T>(
		method: 'get' | 'post',
		route: string,
		body?: unknown,
	): Promise<UserSessionResult<T>> {
		try {
			const response = await fetch(
				`https://discord.com/api/v10${route}`,
				{
					method: method.toUpperCase(),
					headers: buildHeaders(this.token),
					body: body === undefined ? undefined : JSON.stringify(body),
				},
			);

			if (!response.ok) {
				const raw = await response.text();

				return {
					ok: false,
					status: response.status,
					data: null,
					error: extractMessage(raw) ?? `HTTP ${response.status}`,
				};
			}

			const text = await response.text();
			const data = text ? (JSON.parse(text) as T) : (null as T);

			return { ok: true, status: response.status, data, error: null };
		} catch (error) {
			return {
				ok: false,
				status: 0,
				data: null,
				error: (error as Error).message,
			};
		}
	}

	async listQuests(): Promise<UserSessionResult<{ quests: QuestPayload[] }>> {
		return this.request('get', '/quests/@me');
	}

	/**
	 * Reads the account behind the token. Used to show which account a
	 * session belongs to without ever revealing the token.
	 */
	async whoami(): Promise<
		UserSessionResult<{ id: string; username: string }>
	> {
		return this.request('get', '/users/@me');
	}

	async enroll(
		questId: string,
	): Promise<UserSessionResult<unknown>> {
		return this.request('post', `/quests/${questId}/enroll`, {
			location: 11,
			is_targeted: false,
			metadata_raw: null,
		});
	}

	async heartbeat(
		questId: string,
		applicationId: string,
		terminal = false,
	): Promise<UserSessionResult<unknown>> {
		return this.request('post', `/quests/${questId}/heartbeat`, {
			application_id: applicationId,
			terminal,
		});
	}

	async videoProgress(
		questId: string,
		timestamp: number,
	): Promise<UserSessionResult<unknown>> {
		return this.request('post', `/quests/${questId}/video-progress`, {
			timestamp,
		});
	}

	async rewardCode(
		questId: string,
	): Promise<UserSessionResult<{ code: string; platform: number }>> {
		return this.request('get', `/quests/${questId}/reward-code`);
	}
}

/**
 * The desktop client fingerprint plus the raw user token.
 */
function buildHeaders(token: string): Record<string, string> {
	return {
		Authorization: token,
		'User-Agent': USER_AGENT,
		'Content-Type': 'application/json',
		'accept-language': 'vi',
		origin: 'https://discord.com',
		pragma: 'no-cache',
		priority: 'u=1, i',
		referer: 'https://discord.com/channels/@me',
		'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138"',
		'sec-ch-ua-mobile': '?0',
		'sec-ch-ua-platform': '"Windows"',
		'sec-fetch-dest': 'empty',
		'sec-fetch-mode': 'cors',
		'sec-fetch-site': 'same-origin',
		'x-debug-options': 'bugReporterEnabled',
		'x-discord-locale': 'en-US',
		'x-discord-timezone': 'Asia/Saigon',
		'x-super-properties': Buffer.from(
			JSON.stringify(SUPER_PROPERTIES),
		).toString('base64'),
	};
}

function extractMessage(raw: string): string | null {
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as { message?: string };
		return parsed.message ?? null;
	} catch {
		return raw.slice(0, 120);
	}
}
