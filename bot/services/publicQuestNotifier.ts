import { Client } from 'discord.js';
import { Repositories, AnnouncementRow } from '../database/repositories';
import { CatalogProvider } from '../integrations/catalogProvider';
import { QuestDetail } from '../models/quest';
import { questAnnouncementEmbed } from '../ui/embeds';
import { buildAnnouncementRow } from '../ui/components';
import { Logger } from '../utils/logger';

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

export type PublicQuestNotifierOptions = {
	repositories: Repositories;
	catalog: CatalogProvider;
	/** PUBLIC_QUEST_CHANNEL_ID - null disables posting, not tracking. */
	channelId: string | null;
	client?: Client;
	/** Test seam - when set, used instead of the Discord client. */
	sender?: AnnouncementSender;
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
 * - Discord errors (429 rate limits, missing access, unknown channel) never
 *   crash the bot: the row stays `pending` and the next scan retries.
 */
export class PublicQuestNotifier {
	private timer: NodeJS.Timeout | null = null;
	private scanning = false;

	constructor(private readonly options: PublicQuestNotifierOptions) {}

	/** True when a public channel is configured (posting possible). */
	get enabled(): boolean {
		return Boolean(this.options.channelId);
	}

	/** Runs a scan immediately and then every `intervalMinutes`. */
	start(intervalMinutes: number): void {
		if (this.timer) return;

		void this.scan().catch((error: unknown) => {
			Logger.error(
				`Public quest scan failed: ${(error as Error).message}`,
			);
		});

		const interval = Math.max(1, intervalMinutes) * 60_000;
		this.timer = setInterval(() => {
			void this.scan().catch((error: unknown) => {
				Logger.error(
					`Public quest scan failed: ${(error as Error).message}`,
				);
			});
		}, interval);

		Logger.info(
			`Public quest notifier started (every ${intervalMinutes}m, channel ${
				this.enabled ? 'configured' : 'not configured'
			})`,
		);
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
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
		// catalogue quest at once.
		const seeding = repositories.countAnnouncements() === 0;
		let discovered = 0;

		for (const quest of quests) {
			const existing = repositories.getAnnouncement(quest.id);

			if (!existing) {
				repositories.recordAnnouncementSeen(
					quest.id,
					seeding ? 'baseline' : 'pending',
				);
				if (!seeding) discovered++;
			} else {
				// Already tracked: only bump last_detected_at. The existing
				// status (baseline/announced) is preserved by the upsert.
				repositories.recordAnnouncementSeen(quest.id, 'pending');
			}
		}

		let announced = 0;
		let failed = 0;

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

		if (discovered > 0 || announced > 0 || failed > 0) {
			Logger.info(
				`Public quest scan: ${discovered} new, ${announced} announced, ${failed} deferred${
					seeding ? ' (baseline seeded)' : ''
				}`,
			);
		}

		return { discovered, announced, failed, seeded: seeding };
	}

	/** Posts one pending announcement. Never throws. */
	private async announce(
		row: AnnouncementRow,
	): Promise<{ ok: boolean; rateLimited: boolean }> {
		try {
			const detail = await this.options.catalog.require(row.quest_id);
			const sent = await this.send(detail);

			this.options.repositories.markAnnouncementAnnounced(
				row.quest_id,
				sent.id,
				sent.channelId,
			);

			Logger.info(`Announced new quest "${detail.name}" (${row.quest_id})`);
			return { ok: true, rateLimited: false };
		} catch (error) {
			const status = (error as { status?: number })?.status;
			const rateLimited = status === 429;

			Logger.warn(
				`Announcement for ${row.quest_id} failed${
					status ? ` (HTTP ${status})` : ''
				}: ${(error as Error).message} - it stays pending and retries later.`,
			);

			return { ok: false, rateLimited };
		}
	}

	private async send(quest: QuestDetail): Promise<{ id: string; channelId: string }> {
		const payload: AnnouncementPayload = {
			embeds: [questAnnouncementEmbed(quest)],
			components: [buildAnnouncementRow(quest)],
		};

		const { sender, client, channelId } = this.options;

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
