import { randomUUID } from 'node:crypto';
import { Client } from 'discord.js';
import { Repositories, AnnouncementRow } from '../database/repositories';
import { CatalogProvider } from '../integrations/catalogProvider';
import { QuestDetail } from '../models/quest';
import {
	questAnnouncementEmbed,
	type AnnouncementMediaOptions,
} from '../ui/embeds';
import { buildAnnouncementRow } from '../ui/components';
import { Logger } from '../utils/logger';
import type { RuntimeSettings } from './runtimeSettings';

/**
 * What the notifier sends to the public channel. Extracted as a function so
 * the tests can drive the whole detection/dedupe flow without Discord.
 */
export type AnnouncementPayload = {
	embeds: ReturnType<typeof questAnnouncementEmbed>[];
	components: ReturnType<typeof buildAnnouncementRow>[];
};

export type AnnouncementSender = (
	payload: AnnouncementPayload,
) => Promise<{ id: string; channelId: string }>;

export type AnnouncementReconciler = (
	nonce: string,
	questId: string,
) => Promise<{ messageId: string; channelId: string } | null>;

export type ScanResult = {
	/** Quests that were seen for the very first time (after the baseline). */
	discovered: number;
	/** Announcements that were posted in this scan. */
	announced: number;
	/** Announcements that failed (they stay pending and retry later). */
	failed: number;
	/** True when this scan seeded the baseline (first run ever). */
	seeded: boolean;
};

type LiveSettings = Pick<
	RuntimeSettings,
	| 'questMonitoringEnabled'
	| 'questMonitorIntervalMinutes'
	| 'publicQuestChannelId'
	| 'questImagesEnabled'
	| 'questVideosEnabled'
	| 'questMediaFallback'
>;

export type PublicQuestNotifierOptions = {
	repositories: Repositories;
	catalog: CatalogProvider;
	/** PUBLIC_QUEST_CHANNEL_ID - null disables posting, not tracking. */
	channelId: string | null;
	client?: Client;
	/** Test seam - when set, used instead of the Discord client. */
	sender?: AnnouncementSender;
	/** Test seam - finds a message that was sent but not recorded. */
	reconciler?: AnnouncementReconciler;
	/** Test seam - resolves live owner overrides from bot_config. */
	getSettings?: () => LiveSettings;
	/**
	 * Called with the ids of the quests that were discovered *after* the
	 * baseline (never on the seeding scan). Used by the auto-pilot to run
	 * a brand new quest immediately. Must not throw - errors are logged.
	 */
	onDiscovered?: (questIds: string[]) => void;
};

/**
 * Announces newly discovered quests in a public Discord channel.
 *
 * Rules this implementation follows:
 * - The **authoritative catalogue** (`CatalogProvider`) is the only data
 *   source. Nothing private (accounts, tokens, progress, user ids) is ever
 *   part of an announcement.
 * - Every quest is tracked in the `quest_announcements` table (migration
 *   v9). The row - not memory - is the dedupe, so a restart never
 *   reposts an announcement that was already sent.
 * - The very first scan seeds a **baseline** (every currently known quest
 *   is recorded without announcing it); only quests that show up afterwards
 *   are announced, exactly once.
 * - Before posting, a random nonce is stored on the row and written into the
 *   embed footer. If the send succeeds but the database write fails, the
 *   next scan reconciles by channel history instead of posting a duplicate.
 * - Discord errors (429 rate limits, missing access, unknown channel) never
 *   crash the bot: the row stays `pending` and the next scan retries.
 */
export class PublicQuestNotifier {
	private timer: NodeJS.Timeout | null = null;
	private scanning = false;
	private active = false;

	constructor(private readonly options: PublicQuestNotifierOptions) {}

	private settings(): LiveSettings {
		const staticSettings: LiveSettings = {
			questMonitoringEnabled: true,
			questMonitorIntervalMinutes: 15,
			publicQuestChannelId: this.options.channelId,
			questImagesEnabled: true,
			questVideosEnabled: true,
			questMediaFallback: 'neutral',
		};

		return this.options.getSettings
			? { ...staticSettings, ...this.options.getSettings() }
			: staticSettings;
	}

	/** True when monitoring is on and a public channel is configured. */
	get enabled(): boolean {
		const settings = this.settings();
		return Boolean(
			settings.questMonitoringEnabled && settings.publicQuestChannelId,
		);
	}

	/** Runs a scan immediately and then reschedules from live settings. */
	start(intervalMinutes: number): void {
		if (this.active) return;
		this.active = true;

		void this.scan().catch((error: unknown) => {
			Logger.error(`Public quest scan failed: ${(error as Error).message}`);
		});

		this.schedule(intervalMinutes);

		Logger.info(
			`Public quest notifier started (every ${
				this.settings().questMonitorIntervalMinutes
			}m, channel ${
				this.enabled ? 'configured' : 'not configured'
			})`,
		);
	}

	private schedule(fallbackMinutes: number): void {
		if (!this.active) return;

		const minutes = this.settings().questMonitorIntervalMinutes || fallbackMinutes;
		this.timer = setTimeout(() => {
			void this.scan().catch((error: unknown) => {
				Logger.error(
					`Public quest scan failed: ${(error as Error).message}`,
				);
			});
			this.schedule(fallbackMinutes);
		}, Math.max(1, minutes) * 60_000);
	}

	stop(): void {
		this.active = false;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	/**
	 * Detects new quests in the catalogue and announces every quest that is
	 * pending. Safe to call concurrently - overlapping scans are dropped.
	 */
	async scan(): Promise<ScanResult> {
		if (this.scanning) {
			return { discovered: 0, announced: 0, failed: 0, seeded: false };
		}

		this.scanning = true;
		try {
			return await this.scanOnce();
		} finally {
			this.scanning = false;
		}
	}

	private async scanOnce(): Promise<ScanResult> {
		const { repositories, catalog } = this.options;
		const settings = this.settings();
		const canPost = Boolean(
			settings.questMonitoringEnabled && settings.publicQuestChannelId,
		);

		// Re-read the catalogue snapshot first: new quests appear in that
		// file, and a cached copy would hide them forever. A broken/partial
		// file must not break the scan - the cached copy keeps serving.
		try {
			catalog.reload();
		} catch (error) {
			Logger.warn(
				`Catalogue reload failed during a quest scan: ${(error as Error).message}`,
			);
		}

		const quests = await catalog.list();

		// First run ever: seed a baseline so a fresh install (or a database
		// that predates migration v9) does not flood the channel with every
		// catalogue quest at once. When monitoring is off, newly seen quests
		// are still recorded as baseline - enabling later never floods either.
		const seeding = repositories.countAnnouncements() === 0;
		let discovered = 0;
		const discoveredIds: string[] = [];

		for (const quest of quests) {
			const existing = repositories.getAnnouncement(quest.id);
			const detail = await catalog.require(quest.id);

			repositories.transaction(() => {
				// Verified catalogue facts are persisted even for baseline
				// quests - the history is useful when monitoring is off.
				this.persistMetadata(detail);

				if (!existing) {
					repositories.recordAnnouncementSeen(
						quest.id,
						seeding || !canPost ? 'baseline' : 'pending',
					);
					if (!seeding && canPost) {
						discovered++;
						discoveredIds.push(quest.id);
					}
				} else {
					// Already tracked: only bump last_detected_at. The
					// existing status (baseline/announced) is preserved.
					repositories.recordAnnouncementSeen(quest.id, 'pending');
				}
			});
		}

		let announced = 0;
		let failed = 0;

		if (canPost) {
			for (const row of repositories.listAnnouncements('pending')) {
				const result = await this.announce(row);

				if (result.ok) {
					announced++;
					continue;
				}

				failed++;
				if (result.rateLimited) {
					// Discord asked us to slow down - the remaining rows stay
					// pending and are retried on the next scan.
					Logger.warn(
						'Rate limited while announcing a new quest - the remaining announcements are deferred.',
					);
					break;
				}
			}
		}

		if (discovered > 0 || announced > 0 || failed > 0) {
			Logger.info(
				`Public quest scan: ${discovered} new, ${announced} announced, ${failed} deferred${
					seeding ? ' (baseline seeded)' : ''
				}`,
			);
		}

		// Hand the new ids to the listener (the auto-pilot runs them right
		// away). A listener that throws must not break the scan.
		if (discoveredIds.length > 0) {
			try {
				this.options.onDiscovered?.(discoveredIds);
			} catch (error) {
				Logger.warn(
					`New-quest listener failed: ${(error as Error).message}`,
				);
			}
		}

		return { discovered, announced, failed, seeded: seeding };
	}

	/** Stores verified catalogue facts - never user or account data. */
	private persistMetadata(detail: QuestDetail): void {
		this.options.repositories.saveQuestMetadata({
			quest_id: detail.id,
			name: detail.name,
			description: detail.description,
			image_url: detail.imageUrl,
			video_url: detail.videoUrl,
			thumbnail_url: detail.thumbnailUrl,
			rewards: JSON.stringify(detail.rewards),
			official_url: detail.ctaLink ?? null,
			availability: detail.eligibility,
			expires_at: detail.expiresAt,
		});
	}

	/** Posts one pending announcement. Never throws. */
	private async announce(
		row: AnnouncementRow,
	): Promise<{ ok: boolean; rateLimited: boolean }> {
		const nonce = randomUUID();
		const { repositories } = this.options;

		try {
			repositories.beginAnnouncementAttempt(row.quest_id, nonce);
		} catch (error) {
			Logger.warn(
				`Could not record the announcement attempt for ${row.quest_id}: ${
					(error as Error).message
				}`,
			);
		}

		try {
			const detail = await this.options.catalog.require(row.quest_id);

			// If the message went out but the DB write failed, the nonce (or
			// the legacy quest id) is found in channel history. No repost.
			const existing = await this.findExistingMessage(nonce, row.quest_id);
			if (existing) {
				repositories.markAnnouncementAnnounced(
					row.quest_id,
					existing.messageId,
					existing.channelId,
				);
				Logger.info(
					`Reconciled an already posted announcement for ${row.quest_id}`,
				);
				return { ok: true, rateLimited: false };
			}

			const sent = await this.send(detail, nonce);

			repositories.markAnnouncementAnnounced(
				row.quest_id,
				sent.id,
				sent.channelId,
			);

			Logger.info(
				`Announced new quest "${detail.name}" (${row.quest_id})`,
				{ questId: row.quest_id, messageId: sent.id },
			);
			return { ok: true, rateLimited: false };
		} catch (error) {
			const status = (error as { status?: number })?.status;
			const rateLimited = status === 429;

			try {
				repositories.markAnnouncementFailure(
					row.quest_id,
					(error as Error).message,
				);
			} catch {
				// the row may have been deleted by a restore - the next scan
				// will recreate it from the catalogue.
			}

			Logger.warn(
				`Announcement for ${row.quest_id} failed${
					status ? ` (HTTP ${status})` : ''
				}: ${(error as Error).message} - it stays pending and retries later.`,
				{ questId: row.quest_id, attempts: row.attempts + 1 },
			);

			return { ok: false, rateLimited };
		}
	}

	private async findExistingMessage(
		nonce: string,
		questId: string,
	): Promise<{ messageId: string; channelId: string } | null> {
		if (this.options.reconciler) {
			return this.options.reconciler(nonce, questId);
		}

		const { client } = this.options;
		const channelId = this.settings().publicQuestChannelId;
		if (!client || !channelId) return null;

		const channel = await client.channels.fetch(channelId);
		if (!channel || !('messages' in channel)) return null;

		const messages = await channel.messages.fetch({ limit: 50 });

		for (const message of messages.values()) {
			const footers = message.embeds
				.map((embed) => embed.footer?.text ?? '')
				.join(' ');

			if (
				footers.includes(nonce) ||
				footers.includes(`Quest ID ${questId}`)
			) {
				return { messageId: message.id, channelId };
			}
		}

		return null;
	}

	private async send(
		quest: QuestDetail,
		nonce: string,
	): Promise<{ id: string; channelId: string }> {
		const settings = this.settings();
		const media: AnnouncementMediaOptions = {
			imagesEnabled: settings.questImagesEnabled,
			videosEnabled: settings.questVideosEnabled,
			fallback: settings.questMediaFallback,
			nonce,
		};

		const payload: AnnouncementPayload = {
			embeds: [questAnnouncementEmbed(quest, media)],
			components: [buildAnnouncementRow(quest, media)],
		};

		const { sender, client } = this.options;
		const channelId = settings.publicQuestChannelId;

		if (sender) {
			return sender(payload);
		}

		if (!client || !channelId) {
			throw new Error('no public quest channel is configured');
		}

		const channel = await client.channels.fetch(channelId);

		if (!channel || !channel.isTextBased() || !('send' in channel)) {
			throw new Error(
				`channel ${channelId} is not a text channel the bot can post to`,
			);
		}

		const message = await channel.send({
			embeds: payload.embeds,
			components: payload.components,
		});

		return { id: message.id, channelId };
	}
}
