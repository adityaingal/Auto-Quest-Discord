import { ActionRowBuilder, ButtonBuilder, Client } from 'discord.js';
import { Routes } from 'discord-api-types/v10';
import type { Config } from '../config';
import type { Repositories, GuildMembershipRow } from '../database/repositories';
import { membershipRequiredEmbed } from '../ui/embeds';
import { buildMembershipRow } from '../ui/components';
import { Logger } from '../utils/logger';
import type { RuntimeSettings } from './runtimeSettings';

export type MembershipStatus =
	| 'disabled'
	| 'member'
	| 'not-member'
	| 'unverified';

export type MembershipDecision = {
	allowed: boolean;
	status: MembershipStatus;
};

export type MembershipNotice = {
	embeds: ReturnType<typeof membershipRequiredEmbed>[];
	components: ActionRowBuilder<ButtonBuilder>[];
};

type Settings = Pick<
	RuntimeSettings,
	| 'membershipVerificationEnabled'
	| 'requiredGuildId'
	| 'requiredGuildInvite'
	| 'membershipVerifyIntervalMinutes'
	| 'membershipMemberEvents'
>;

export type MembershipServiceOptions = {
	repositories: Repositories;
	config: Config;
	client: Client;
	/** Test seam - resolves live owner overrides from bot_config. */
	getSettings?: () => Settings;
	/** Test seam - replaces the Discord REST membership lookup. */
	fetchMember?: (
		guildId: string,
		userId: string,
	) => Promise<{ joinedAt: string | null }>;
	/** Test seam - replaces the "you left, here is the invite" DM. */
	notify?: (userId: string, payload: MembershipNotice) => Promise<void>;
};

const MEMBER_CACHE_MS = 30_000;
const NOT_MEMBER_CACHE_MS = 10_000;
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Mandatory guild membership for DM usage.
 *
 * The REST lookup is authoritative: a cached value only short-circuits a
 * *positive* result for a few seconds. 404 is a real "not a member"; 403,
 * 429, 5xx, timeouts and unavailable guilds are uncertain and always deny.
 */
export class MembershipService {
	private readonly cache = new Map<string, { until: number; member: boolean }>();
	private reconciling = false;

	constructor(private readonly options: MembershipServiceOptions) {}

	private settings(): Settings {
		const base: Settings = {
			membershipVerificationEnabled:
				this.options.config.membershipVerificationEnabled,
			requiredGuildId: this.options.config.requiredGuildId,
			requiredGuildInvite: this.options.config.requiredGuildInvite,
			membershipVerifyIntervalMinutes:
				this.options.config.membershipVerifyIntervalMinutes,
			membershipMemberEvents: this.options.config.membershipMemberEvents,
		};

		return this.options.getSettings
			? { ...base, ...this.options.getSettings() }
			: base;
	}

	/** Called by the gateway listeners only when the opt-in intent is on. */
	get memberEventsEnabled(): boolean {
		return this.settings().membershipMemberEvents ?? false;
	}

	/** Payload for a denied DM - safe to send from both interaction paths. */
	denial(): MembershipNotice {
		const invite = this.settings().requiredGuildInvite;
		const row = buildMembershipRow(invite);

		return {
			embeds: [membershipRequiredEmbed(invite)],
			components: row ? [row] : [],
		};
	}

	private invalidate(userId: string): void {
		this.cache.delete(userId);
	}

	/** Verifies membership before a DM command is allowed to run. */
	async verify(userId: string): Promise<MembershipDecision> {
		const settings = this.settings();

		if (!settings.membershipVerificationEnabled) {
			return { allowed: true, status: 'disabled' };
		}

		if (!settings.requiredGuildId) {
			Logger.warn(
				'Membership verification is on but no guild is configured - DM access denied.',
			);
			return { allowed: false, status: 'unverified' };
		}

		const cached = this.cache.get(userId);
		if (cached && Date.now() < cached.until) {
			return cached.member
				? { allowed: true, status: 'member' }
				: { allowed: false, status: 'not-member' };
		}

		return this.verifyFromApi(userId, settings.requiredGuildId);
	}

	private async verifyFromApi(
		userId: string,
		guildId: string,
	): Promise<MembershipDecision> {
		try {
			const result = await this.lookup(guildId, userId);

			this.options.repositories.recordMembership({
				discord_user_id: userId,
				guild_id: guildId,
				is_member: true,
				joined_at: result.joinedAt,
			});
			this.cache.set(userId, {
				until: Date.now() + MEMBER_CACHE_MS,
				member: true,
			});

			return { allowed: true, status: 'member' };
		} catch (error) {
			const status = (error as { status?: number })?.status;

			if (status === 404) {
				await this.markLeft(userId, guildId);
				this.cache.set(userId, {
					until: Date.now() + NOT_MEMBER_CACHE_MS,
					member: false,
				});
				return { allowed: false, status: 'not-member' };
			}

			const detail = status ? `HTTP ${status}` : (error as Error).message;
			this.options.repositories.recordMembershipError(
				userId,
				guildId,
				detail,
			);
			Logger.warn(
				`Membership check for ${userId} is uncertain (${detail}) - access denied.`,
				{ guildId, userId, status: status ?? null },
			);

			return { allowed: false, status: 'unverified' };
		}
	}

	private async lookup(
		guildId: string,
		userId: string,
	): Promise<{ joinedAt: string | null }> {
		if (this.options.fetchMember) {
			return this.options.fetchMember(guildId, userId);
		}

		const response = (await this.options.client.rest.get(
			Routes.guildMember(guildId, userId),
			{ signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) } as never,
		)) as { joined_at?: string | null };

		return { joinedAt: response?.joined_at ?? null };
	}

	/** Sends the invite once on a true -> false transition. */
	private async markLeft(userId: string, guildId: string): Promise<void> {
		const before = this.options.repositories.getMembership(userId, guildId);
		this.options.repositories.recordMembership({
			discord_user_id: userId,
			guild_id: guildId,
			is_member: false,
		});
		this.invalidate(userId);

		if (!before?.is_member) return;

		await this.sendNotice(userId).catch((error: unknown) => {
			// Closed DMs are normal - never crash a command or an event.
			Logger.warn(
				`Could not DM ${userId} about membership: ${(error as Error).message}`,
			);
		});
	}

	private async sendNotice(userId: string): Promise<void> {
		if (this.options.notify) {
			await this.options.notify(userId, this.denial());
			return;
		}

		const user = await this.options.client.users.fetch(userId);
		await user.send(this.denial() as never);
	}

	/** Gateway `guildMemberAdd` hook. */
	onMemberAdd(userId: string, joinedAt: string | null = null): void {
		const guildId = this.settings().requiredGuildId;
		if (!guildId) return;

		this.options.repositories.recordMembership({
			discord_user_id: userId,
			guild_id: guildId,
			is_member: true,
			joined_at: joinedAt,
		});
		this.cache.set(userId, {
			until: Date.now() + MEMBER_CACHE_MS,
			member: true,
		});
	}

	/** Gateway `guildMemberRemove` hook. */
	async onMemberRemove(userId: string): Promise<void> {
		const guildId = this.settings().requiredGuildId;
		if (!guildId) return;

		await this.markLeft(userId, guildId);
	}

	/**
	 * Periodic reconciliation. Only users who were previously verified are
	 * checked, so a failed API never grants access and a leave is detected
	 * even when the gateway event was missed.
	 */
	async reconcile(): Promise<{ checked: number; removed: number }> {
		if (this.reconciling) return { checked: 0, removed: 0 };
		if (!this.settings().membershipVerificationEnabled) {
			return { checked: 0, removed: 0 };
		}

		this.reconciling = true;
		let checked = 0;
		let removed = 0;

		try {
			const guildId = this.settings().requiredGuildId;
			if (!guildId) return { checked, removed };

			const members: GuildMembershipRow[] =
				this.options.repositories.listMembers(guildId);

			for (const member of members) {
				this.invalidate(member.discord_user_id);
				const decision = await this.verifyFromApi(
					member.discord_user_id,
					guildId,
				);
				checked++;

				if (decision.status === 'not-member') {
					removed++;
				}
			}
		} finally {
			this.reconciling = false;
		}

		return { checked, removed };
	}

	start(intervalMinutes: number): void {
		if (this.timer || !this.settings().membershipVerificationEnabled) return;
		this.schedule(intervalMinutes);
	}

	private schedule(fallbackMinutes: number): void {
		const minutes =
			this.settings().membershipVerifyIntervalMinutes || fallbackMinutes;

		this.timer = setTimeout(() => {
			void this.reconcile()
				.then((result) => {
					if (result.removed > 0) {
						Logger.info(
							`Membership reconciliation: ${result.removed} member(s) left.`,
							{ checked: result.checked, removed: result.removed },
						);
					}
				})
				.catch((error: unknown) => {
					Logger.warn(
						`Membership reconciliation failed: ${(error as Error).message}`,
					);
				});
			this.schedule(fallbackMinutes);
		}, Math.max(1, minutes) * 60_000);
	}

	private timer: NodeJS.Timeout | null = null;

	stop(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}
}
