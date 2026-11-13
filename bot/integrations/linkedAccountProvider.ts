import { Quest } from '../../src/quest';
import { AllQuestsResponse } from '../../src/interface';
import { QuestDetail, QuestView } from '../models/quest';
import { toQuestDetail, toQuestView } from '../services/questAdapter';
import { QuestProvider } from './questProvider';
import { DiscordUserApi } from './discordUserApi';
import {
	AuthorizationError,
	IntegrationUnavailableError,
	NotFoundError,
} from '../utils/errors';

export type TokenResolver = (
	discordUserId: string,
) => Promise<string | null>;

export type LiveQuestState = {
	quests: Quest[];
	raw: AllQuestsResponse;
};

/**
 * Reads the live quest list of a *linked* account.
 *
 * Discord's quest endpoints are user-session endpoints: they are not covered by
 * OAuth2 scopes, so Discord rejects bot and OAuth2 credentials with 401. That
 * is not hidden from the user - the provider reports the integration as
 * unavailable instead of pretending it works.
 */
export class LinkedAccountProvider implements QuestProvider {
	public readonly name = 'linked-account';
	public readonly live = true;

	constructor(private readonly resolveToken: TokenResolver) {}

	private async apiFor(
		discordUserId: string,
	): Promise<DiscordUserApi | null> {
		const token = await this.resolveToken(discordUserId);
		if (!token) return null;

		return new DiscordUserApi(token);
	}

	/**
	 * Fetches the live quest payload for a linked account.
	 */
	async fetchLive(discordUserId: string): Promise<LiveQuestState> {
		const api = await this.apiFor(discordUserId);
		if (!api) {
			throw new AuthorizationError(
				'No linked Discord account for this user.',
			);
		}

		const response = await api.get<AllQuestsResponse>('/quests/@me');

		if (!response.ok) {
			if (response.status === 401 || response.status === 403) {
				throw new IntegrationUnavailableError(
					'Live quest data',
					"Discord's quest endpoints require a user session and are not covered by OAuth2 scopes, so a bot cannot read them. The bundled catalogue is used instead.",
				);
			}

			throw new IntegrationUnavailableError(
				'Live quest data',
				`Discord answered with HTTP ${response.status}.`,
			);
		}

		const raw = response.data as AllQuestsResponse;

		return {
			raw,
			quests: (raw.quests ?? []).map((quest) => Quest.create(quest)),
		};
	}

	async list(): Promise<QuestView[]> {
		throw new IntegrationUnavailableError(
			'Live quest data',
			'A linked account is required.',
		);
	}

	async listFor(discordUserId: string): Promise<QuestView[]> {
		const live = await this.fetchLive(discordUserId);

		return live.quests.map((quest) => toQuestView(quest, this.name, true));
	}

	async get(
		questId: string,
		discordUserId: string,
	): Promise<QuestDetail | null> {
		const live = await this.fetchLive(discordUserId);
		const quest = live.quests.find((entry) => entry.id === questId);

		if (!quest) return null;

		return toQuestDetail(quest, this.name, true);
	}

	async require(
		questId: string,
		discordUserId: string,
	): Promise<QuestDetail> {
		const quest = await this.get(questId, discordUserId);
		if (!quest) {
			throw new NotFoundError(
				`Quest \`${questId}\` is not available for this account.`,
			);
		}
		return quest;
	}

	/**
	 * Retrieves a claimed reward code through Discord's documented reward-code
	 * endpoint. No captcha handling happens here - the human solves it in the
	 * client when Discord asks for it.
	 */
	async rewardCode(
		questId: string,
		discordUserId: string,
	): Promise<{ code: string; platform: number | null }> {
		const api = await this.apiFor(discordUserId);
		if (!api) {
			throw new AuthorizationError(
				'No linked Discord account for this user.',
			);
		}

		const response = await api.get<{
			code: string;
			platform: number;
		}>(`/quests/${questId}/reward-code`);

		if (!response.ok || !response.data) {
			throw new IntegrationUnavailableError(
				'Reward code',
				`Discord did not return a reward code (HTTP ${response.status}). The reward has to be claimed in the Discord client first.`,
			);
		}

		return {
			code: response.data.code,
			platform: response.data.platform ?? null,
		};
	}

	/**
	 * Attempts the official claim endpoint. Discord answers with a captcha
	 * challenge for most accounts - we forward that as a clean message and let
	 * the human finish it in the client.
	 */
	async claim(
		questId: string,
		discordUserId: string,
	): Promise<{ claimed: boolean; message: string }> {
		const api = await this.apiFor(discordUserId);
		if (!api) {
			throw new AuthorizationError(
				'No linked Discord account for this user.',
			);
		}

		const rest = new (await import('discord.js')).REST({
			version: '10',
		}).setToken(await this.resolveToken(discordUserId) ?? '');

		try {
			const result = (await rest.post(`/quests/${questId}/claim-reward`, {
				body: { location: 11, platform: 0 },
			})) as { claimed_at?: string | null };

			return {
				claimed: Boolean(result?.claimed_at),
				message: result?.claimed_at
					? 'The reward was claimed.'
					: 'Discord accepted the request but did not confirm a claim.',
			};
		} catch (error) {
			const status = (error as { status?: number })?.status;
			const raw =
				(error as { rawError?: { captcha_key?: string[] } })?.rawError ??
				undefined;

			if (raw?.captcha_key?.includes('captcha-required')) {
				return {
					claimed: false,
					message:
						'Discord requires a human captcha verification for this claim. Finish it in the Discord client (Quest Home -> Claim).',
				};
			}

			if (status === 401 || status === 403) {
				return {
					claimed: false,
					message:
						'Discord refused the claim for this account. Claim it in the Discord client instead.',
				};
			}

			throw error;
		}
	}
}
