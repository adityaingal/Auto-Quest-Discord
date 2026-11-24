import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database, MIGRATIONS } from '../bot/database';
import { Repositories } from '../bot/database/repositories';
import { CatalogProvider } from '../bot/integrations/catalogProvider';
import { IntegrationUnavailableError } from '../bot/utils/errors';
import {
	PublicQuestNotifier,
	type AnnouncementPayload,
} from '../bot/services/publicQuestNotifier';
import { QuestService } from '../bot/services/questService';
import { ProgressService } from '../bot/services/progressService';
import { RewardService } from '../bot/services/rewardService';
import {
	resolveEligibility,
	toQuestViewFromPayload,
} from '../bot/services/questAdapter';
import { Quest } from '../src/quest';
import { QuestEligibility } from '../bot/models/enums';
import { AccountScope } from '../bot/services/scope';
import {
	buildPublicQuestPanel,
	buildQuestPanel,
	publicQuestPages,
	PUBLIC_PANEL_IDS,
} from '../bot/ui/panel';
import {
	questAnnouncementEmbed,
	verifiedQuestUrl,
	checkProgressEmbed,
} from '../bot/ui/embeds';
import { buildAnnouncementRow } from '../bot/ui/components';
import { InteractionRouter } from '../bot/commands/interactions';

const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const PAST = new Date(Date.now() - 3600_000).toISOString();

/** The scope the tests work in. */
const SCOPE: AccountScope = { userId: 'user-1', isOperator: false };

type StatusOverrides = {
	expiresAt?: string;
	enrolledAt?: string | null;
	completedAt?: string | null;
	claimedAt?: string | null;
	value?: number;
	target?: number;
};

/**
 * A quest payload in the shape the live API (and the catalogue snapshot)
 * uses. No token, no account data - only public quest facts.
 */
function shape(id: string, options: StatusOverrides = {}) {
	const target = options.target ?? 60;
	const value = options.completedAt ? target : (options.value ?? 0);

	const userStatus =
		options.completedAt || options.enrolledAt || value > 0
			? {
					enrolled_at: options.enrolledAt ?? PAST,
					completed_at: options.completedAt ?? null,
					claimed_at: options.claimedAt ?? null,
					progress: { WATCH_VIDEO: { value } },
				}
			: null;

	return {
		id,
		config: {
			messages: {
				quest_name: `Quest ${id}`,
				game_title: 'Test Game',
				game_publisher: 'Publisher',
			},
			application: { id: 'app-1', name: 'Game' },
			task_config_v2: { tasks: { WATCH_VIDEO: { target } } },
			rewards_config: {
				rewards: [
					{
						type: 4,
						orb_quantity: 700,
						messages: { name: '700 Orbs' },
					},
				],
				platforms: [0],
			},
			expires_at: options.expiresAt ?? FUTURE,
			assets: { hero: '/assets/hero.png' },
			cta_config: {
				link: 'https://discord.com/quests/abc',
				button_label: 'View Quest',
			},
		},
		user_status: userStatus,
		targeted_content: [],
		preview: false,
	} as never;
}

function tempCatalogue(
	t: { after(fn: () => void): void },
	ids: string[],
): { dir: string; file: string; catalog: CatalogProvider } {
	const dir = mkdtempSync(join(tmpdir(), 'quest-public-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));

	const file = join(dir, 'quest.json');
	writeCatalogue(file, ids);

	return { dir, file, catalog: new CatalogProvider(file) };
}

function writeCatalogue(file: string, ids: string[]): void {
	writeFileSync(
		file,
		JSON.stringify({ quests: ids.map((id) => shape(id)) }),
	);
}

function fakeLinked() {
	return {
		listFor: async () => {
			throw new IntegrationUnavailableError('Live quest data', 'test');
		},
		require: async () => {
			throw new IntegrationUnavailableError('Live quest data', 'test');
		},
		claim: async () => ({ claimed: false, message: 'n/a' }),
		rewardCode: async () => ({ code: 'ABC', platform: 0 }),
	};
}

// ------------------------------------------------------------- migrations

test('the newest migration is v9 and the older ones were not edited', () => {
	assert.deepEqual(
		MIGRATIONS.map((migration) => migration.version),
		[1, 2, 3, 4, 5, 6, 7, 8, 9],
	);

	const v9 = MIGRATIONS[MIGRATIONS.length - 1];
	assert.equal(v9.name, 'quest_announcements');
	assert.ok(v9.sql.includes('quest_id TEXT PRIMARY KEY'));
	assert.ok(v9.sql.includes('first_discovered_at'));
	assert.ok(v9.sql.includes('last_detected_at'));
	assert.ok(v9.sql.includes('announcement_status'));
	assert.ok(v9.sql.includes('message_id'));
	assert.ok(v9.sql.includes('channel_id'));
	assert.ok(v9.sql.includes('idx_quest_announcements_status'));
});

// ------------------------------------------------- status mapping (part 1)

test('an expired quest is reported as Expired, not folded into Unavailable', () => {
	const expired = Quest.create(shape('e1', { expiresAt: PAST }));
	assert.equal(resolveEligibility(expired), QuestEligibility.EXPIRED);
});

test('a completed quest stays Completed even after its expiry date', () => {
	const completed = Quest.create(
		shape('e2', { expiresAt: PAST, completedAt: PAST }),
	);
	assert.equal(resolveEligibility(completed), QuestEligibility.COMPLETED);
});

test('enrolled, in progress and available states are detected', () => {
	const enrolled = Quest.create(shape('e3', { enrolledAt: PAST }));
	assert.equal(resolveEligibility(enrolled), QuestEligibility.ENROLLED);

	const progressing = Quest.create(shape('e4', { value: 30 }));
	assert.equal(resolveEligibility(progressing), QuestEligibility.IN_PROGRESS);

	const available = Quest.create(shape('e5'));
	assert.equal(resolveEligibility(available), QuestEligibility.AVAILABLE);
});

test('the reward status uses the enum for the completed check', async () => {
	const db = new Database(':memory:');
	db.migrate();
	const repositories = new Repositories(db);
	const rewardService = new RewardService(repositories, fakeLinked() as never);

	const done = toQuestViewFromPayload(
		shape('r1', { completedAt: PAST, claimedAt: null }),
	);
	const open = toQuestViewFromPayload(shape('r2'));

	assert.equal(rewardService.buildStatus(done).eligible, true);
	assert.equal(rewardService.buildStatus(open).eligible, false);

	db.close();
});

// ---------------------------------------------------- announcement embed

test('the announcement embed carries the facts and no private data', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'quest-embed-'));
	writeCatalogue(join(dir, 'quest.json'), ['ann-1']);
	const provider = new CatalogProvider(join(dir, 'quest.json'));
	const detail = await provider.require('ann-1');
	rmSync(dir, { recursive: true, force: true });

	const json = questAnnouncementEmbed(detail).toJSON();
	const text = JSON.stringify(json);

	// Name, promo text, reward, requirements, platform, expiry, availability.
	assert.ok(text.includes('Quest ann-1'));
	assert.ok(text.includes('Test Game'));
	assert.ok(text.includes('700 Orbs'));
	assert.ok(text.includes('WATCH_VIDEO'));
	assert.ok(text.includes('Cross-platform'));
	assert.ok(text.includes('Expires'));
	assert.ok(text.includes('Availability'));
	assert.ok(json.image?.url?.includes('assets/hero.png'));

	// Nothing account or user specific may leak into a public message.
	assert.ok(!text.includes('user_id'));
	assert.ok(!text.includes('user_status'));
	assert.ok(!text.includes('token'));

	// Buttons: View Quest (verified https URL), Available Quests, Refresh.
	const row = buildAnnouncementRow(detail).toJSON() as {
		components: { custom_id?: string; url?: string; label?: string }[];
	};
	const ids = row.components.map((component) => component.custom_id);
	assert.ok(ids.includes('quest:ann_quests'));
	assert.ok(ids.some((id) => id?.startsWith('quest:ann_refresh:')));
	const link = row.components.find((component) => component.url);
	assert.equal(link?.label, 'View Quest');
	assert.ok(link?.url?.startsWith('https://'));
});

test('only a verified https URL becomes a button', () => {
	assert.equal(verifiedQuestUrl({ ctaLink: null }), null);
	assert.equal(verifiedQuestUrl({ ctaLink: 'javascript:alert(1)' }), null);
	assert.equal(verifiedQuestUrl({ ctaLink: 'http://evil.example' }), null);
	assert.equal(
		verifiedQuestUrl({ ctaLink: 'https://discord.com/quests/x' }),
		'https://discord.com/quests/x',
	);
});

// ----------------------------------------------------- notifier (part 2)

test('the first scan seeds a baseline instead of announcing everything', async (t) => {
	const { file, catalog } = tempCatalogue(t, ['q1', 'q2']);
	const db = new Database(':memory:');
	t.after(() => db.close());
	db.migrate();
	const repositories = new Repositories(db);

	const sent: AnnouncementPayload[] = [];
	const notifier = new PublicQuestNotifier({
		repositories,
		catalog,
		channelId: 'channel-1',
		sender: async (payload) => {
			sent.push(payload);
			return { id: `msg-${sent.length}`, channelId: 'channel-1' };
		},
	});

	const first = await notifier.scan();
	assert.equal(first.seeded, true);
	assert.equal(first.announced, 0);
	assert.equal(sent.length, 0, 'the baseline must not be announced');
	assert.equal(repositories.countAnnouncements(), 2);

	const second = await notifier.scan();
	assert.equal(second.seeded, false);
	assert.equal(sent.length, 0, 'a second scan must not repost');
});

test('a newly discovered quest is announced exactly once', async (t) => {
	const { file, catalog } = tempCatalogue(t, ['q1']);
	const db = new Database(':memory:');
	t.after(() => db.close());
	db.migrate();
	const repositories = new Repositories(db);

	const sent: AnnouncementPayload[] = [];
	const makeNotifier = () =>
		new PublicQuestNotifier({
			repositories,
			catalog,
			channelId: 'channel-1',
			sender: async (payload) => {
				sent.push(payload);
				return { id: `msg-${sent.length}`, channelId: 'channel-1' };
			},
		});

	const notifier = makeNotifier();
	await notifier.scan(); // baseline

	writeCatalogue(file, ['q1', 'brand-new']);

	const discovered = await notifier.scan();
	assert.equal(discovered.discovered, 1);
	assert.equal(discovered.announced, 1);
	assert.equal(sent.length, 1);

	const row = repositories.getAnnouncement('brand-new');
	assert.equal(row?.announcement_status, 'announced');
	assert.equal(row?.message_id, 'msg-1');
	assert.equal(row?.channel_id, 'channel-1');

	// Scanning again (and even restarting the notifier) never reposts.
	await notifier.scan();
	const restarted = makeNotifier();
	await restarted.scan();
	assert.equal(sent.length, 1, 'a restart must not repost');
});

test('a rate limited announcement stays pending and is retried later', async (t) => {
	const { file, catalog } = tempCatalogue(t, ['q1']);
	const db = new Database(':memory:');
	t.after(() => db.close());
	db.migrate();
	const repositories = new Repositories(db);

	let failing = true;
	const sent: AnnouncementPayload[] = [];
	const notifier = new PublicQuestNotifier({
		repositories,
		catalog,
		channelId: 'channel-1',
		sender: async (payload) => {
			if (failing) {
				const error = new Error('rate limited') as Error & {
					status: number;
				};
				error.status = 429;
				throw error;
			}
			sent.push(payload);
			return { id: `msg-${sent.length}`, channelId: 'channel-1' };
		},
	});

	await notifier.scan(); // baseline
	writeCatalogue(file, ['q1', 'q2']);

	const limited = await notifier.scan();
	assert.equal(limited.discovered, 1);
	assert.equal(limited.announced, 0);
	assert.equal(limited.failed, 1);
	assert.equal(
		repositories.getAnnouncement('q2')?.announcement_status,
		'pending',
		'a failed announcement must stay pending',
	);

	failing = false;
	const retried = await notifier.scan();
	assert.equal(retried.announced, 1);
	assert.equal(sent.length, 1);
	assert.equal(
		repositories.getAnnouncement('q2')?.announcement_status,
		'announced',
	);
});

test('without a channel the notifier tracks quests but never posts', async (t) => {
	const { catalog } = tempCatalogue(t, ['q1']);
	const db = new Database(':memory:');
	t.after(() => db.close());
	db.migrate();
	const repositories = new Repositories(db);

	const notifier = new PublicQuestNotifier({
		repositories,
		catalog,
		channelId: null,
		sender: async () => {
			throw new Error('must not be called');
		},
	});

	assert.equal(notifier.enabled, false);
	const result = await notifier.scan();
	assert.equal(result.seeded, true);
	assert.equal(repositories.countAnnouncements(), 1);
});

// --------------------------------------------------- public panel (part 4)

test('the public browser paginates beyond 25 quests', () => {
	const quests = Array.from({ length: 60 }, (_, index) =>
		toQuestViewFromPayload(shape(`p${index}`)),
	);

	const pages = publicQuestPages(quests);
	assert.equal(pages.length, 3);
	assert.equal(pages[0].length, 25);
	assert.equal(pages[2].length, 10);

	const panel = buildPublicQuestPanel(quests, 999); // clamped to the last page
	const menu = panel.components[0].toJSON() as {
		components: { options: unknown[] }[];
	};
	assert.equal(menu.components[0].options.length, 10);

	const embed = panel.embeds[0].toJSON();
	assert.equal(embed.footer?.text?.includes('Page 3/3'), true);

	// Every page lists at most 25 entries (Discord's dropdown limit).
	for (const page of [0, 1, 2]) {
		const slice = publicQuestPages(quests)[page];
		assert.ok(slice.length <= 25);
	}
});

test('no panel ever exceeds the five component rows Discord allows', async (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'quest-rows-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const file = join(dir, 'quest.json');
	// 30 quests -> two pages -> the pagination row is present (worst case
	// for the panel: six rows before the fix that merged the run buttons).
	writeFileSync(
		file,
		JSON.stringify({
			quests: Array.from({ length: 30 }, (_, index) =>
				shape(`row-${index}`),
			),
		}),
	);
	const catalog = new CatalogProvider(file);
	const detail = await catalog.require('row-0');
	const quests = await catalog.list();

	const rowIds = (payload: {
		components: { toJSON(): { components: unknown[] } }[];
	}) =>
		payload.components.flatMap((row) =>
			(row.toJSON().components as { custom_id?: string }[]).map(
				(component) => component.custom_id ?? '',
			),
		);

	const panel = buildQuestPanel(detail, quests, 0, null, 'all');
	assert.ok(
		panel.components.length <= 5,
		`the quest panel must not send more than 5 rows (sent ${panel.components.length})`,
	);

	const ids = rowIds(panel);
	assert.ok(
		ids.includes('quest:check_all'),
		'the check-all button stays on the panel',
	);
	assert.ok(
		ids.some((id) => id.startsWith('quest:panel_complete_all:')),
		'the complete-all button stays on the panel',
	);

	// The public browser and the announcement must respect the limit too.
	const publicPanel = buildPublicQuestPanel(quests, 0);
	assert.ok(publicPanel.components.length <= 5);
});

test('the public panel shows availability and expired states', () => {
	const quests = [
		toQuestViewFromPayload(shape('open')),
		toQuestViewFromPayload(shape('old', { expiresAt: PAST })),
	];

	const panel = buildPublicQuestPanel(quests, 0);
	const description = panel.embeds[0].toJSON().description ?? '';

	assert.ok(description.includes('Available'));
	assert.ok(description.includes('Expired'));
	assert.ok(description.includes('Quest open'));
	assert.ok(description.includes('Quest old'));
});

test('the public browser routes without ever building a scope', async (t) => {
	const { catalog } = tempCatalogue(t, ['q1', 'q2', 'q3']);
	const db = new Database(':memory:');
	t.after(() => db.close());
	db.migrate();

	let scopeCalls = 0;
	const services = {
		catalog,
		scopeFor: () => {
			scopeCalls++;
			return { userId: 'someone', isOperator: false };
		},
	} as never;

	const router = new InteractionRouter(services);

	const capture: {
		updated: { embeds?: { toJSON(): { title?: string } }[] } | null;
		replied: { embeds?: { toJSON(): { title?: string } }[] } | null;
	} = { updated: null, replied: null };

	type UpdatePayload = { embeds?: { toJSON(): { title?: string } }[] };
	type ReplyPayload = { embeds?: { toJSON(): { title?: string } }[] };

	const base = {
		type: 3,
		user: { id: 'user-9' },
		isMessageComponent: () => true,
		isStringSelectMenu: () => false,
		isButton: () => true,
		isRepliable: () => true,
		reply: async (payload: ReplyPayload) => {
			capture.replied = payload;
		},
		update: async (payload: UpdatePayload) => {
			capture.updated = payload;
		},
	};

	// Next page.
	await router.handle({
		...base,
		customId: 'quest:pub_next:0',
	} as never);
	assert.equal(capture.updated?.embeds?.[0].toJSON().title, 'AVAILABLE QUESTS');

	// Refresh.
	await router.handle({
		...base,
		customId: 'quest:pub_refresh:0',
	} as never);
	assert.equal(capture.updated?.embeds?.[0].toJSON().title, 'AVAILABLE QUESTS');

	// Quest Details (first quest of the page).
	await router.handle({
		...base,
		customId: 'quest:pub_details:0',
	} as never);
	assert.equal(capture.updated?.embeds?.[0].toJSON().title, 'QUEST: Quest q1');

	// Select menu opens the detail view.
	await router.handle({
		...base,
		customId: 'quest:pub_select:0',
		isStringSelectMenu: () => true,
		values: ['q3'],
	} as never);
	assert.equal(capture.updated?.embeds?.[0].toJSON().title, 'QUEST: Quest q3');

	// The "Available Quests" button of an announcement.
	await router.handle({
		...base,
		customId: 'quest:ann_quests',
	} as never);
	assert.equal(capture.replied?.embeds?.[0].toJSON().title, 'AVAILABLE QUESTS');

	assert.equal(
		scopeCalls,
		0,
		'public handlers must never resolve an account scope',
	);
});

test('an unauthorized user cannot operate the owner panel', async () => {
	const services = {
		config: { ownerIds: ['owner-1'] },
		adminService: { isWhitelistedAdmin: () => false },
	} as never;

	const router = new InteractionRouter(services);

	const capture: { replied: { content?: string } | null } = { replied: null };
	const interaction = {
		type: 3,
		customId: 'owner:panel_select:0',
		user: { id: 'stranger' },
		member: null,
		values: ['admin.stats'],
		isStringSelectMenu: () => true,
		isRepliable: () => true,
		showModal: async () => {
			throw new Error('a modal must not be shown to a stranger');
		},
		reply: async (payload: { content?: string }) => {
			capture.replied = payload;
		},
	} as never;

	await router.handle(interaction);

	assert.ok(capture.replied, 'the interaction must be answered');
	assert.match(
		String(capture.replied?.content),
		/owner and admins only/,
		'the denial must be shown',
	);
});

// ----------------------------------------------- check all progress (p5)

test('check all progress summarises only the caller and syncs status', async (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'quest-check-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const file = join(dir, 'quest.json');
	writeFileSync(
		file,
		JSON.stringify({
			quests: [
				shape('ok'),
				shape('old', { expiresAt: PAST }),
				shape('done', { completedAt: PAST, claimedAt: null }),
			],
		}),
	);
	const catalog = new CatalogProvider(file);
	const db = new Database(':memory:');
	t.after(() => db.close());
	db.migrate();
	const repositories = new Repositories(db);
	const progressService = new ProgressService(repositories);
	const questService = new QuestService(
		repositories,
		catalog,
		fakeLinked() as never,
		undefined,
		progressService,
	);

	// Another user's data must stay untouched.
	repositories.saveProgress({
		discord_user_id: 'user-2',
		quest_id: 'ok',
		status: 'in-progress',
		value: 1,
		target: 60,
		percent: 2,
		enrolled_at: null,
		completed_at: null,
		claimed_at: null,
	});

	const summary = await questService.checkAll(SCOPE);

	assert.equal(summary.total, 3);
	assert.equal(summary.available, 1);
	assert.equal(summary.expired, 1);
	assert.equal(summary.completed, 1);
	assert.equal(summary.claimable, 1, 'completed but unclaimed');
	assert.equal(summary.live, false, 'no authenticated account answered');

	// Progress was recorded for the caller only - the values come from the
	// quest data (target from the task config, value from the snapshot).
	const mine = repositories.listProgress('user-1');
	assert.deepEqual(
		mine.map((row) => row.quest_id).sort(),
		['done', 'ok', 'old'],
	);
	assert.equal(repositories.getProgress('user-2', 'ok')?.value, 1);

	// Percentages come from the verified values.
	const done = mine.find((row) => row.quest_id === 'done');
	assert.equal(done?.status, QuestEligibility.COMPLETED);
	assert.equal(done?.percent, 100);

	const embed = checkProgressEmbed(summary).toJSON();
	const text = JSON.stringify(embed);
	assert.ok(text.includes('Total quests'));
	assert.ok(text.includes('Completed'));
	assert.ok(text.includes('Expired'));
	assert.ok(text.includes('Claimable rewards'));
	assert.ok(text.includes('Nothing was claimed automatically'));
});

test('a live account refresh updates the stored progress', async (t) => {
	const { catalog } = tempCatalogue(t, ['live-quest']);
	const db = new Database(':memory:');
	t.after(() => db.close());
	db.migrate();
	const repositories = new Repositories(db);
	const progressService = new ProgressService(repositories);

	// One account of the caller answers with a live quest.
	const autoService = {
		listAllLiveQuests: async () => [
			{
				account: 'acc-1',
				quests: [
					shape('live-quest', {
						enrolledAt: PAST,
						value: 30,
						target: 60,
					}),
				],
				error: null,
			},
		],
	} as never;

	const questService = new QuestService(
		repositories,
		catalog,
		fakeLinked() as never,
		autoService,
		progressService,
	);

	const summary = await questService.checkAll(SCOPE);

	assert.equal(summary.live, true);
	assert.deepEqual(summary.accounts, ['acc-1']);

	const stored = repositories.getProgress('user-1', 'live-quest');
	assert.ok(stored, 'the refreshed progress must be stored');
	assert.equal(stored.value, 30);
	assert.equal(stored.target, 60);
	assert.equal(stored.percent, 50);
	assert.equal(stored.status, QuestEligibility.IN_PROGRESS);
});

test('a stored completion is restored when the live source loses it', async (t) => {
	const { catalog } = tempCatalogue(t, ['fading']);
	const db = new Database(':memory:');
	t.after(() => db.close());
	db.migrate();
	const repositories = new Repositories(db);
	const progressService = new ProgressService(repositories);
	const questService = new QuestService(
		repositories,
		catalog,
		fakeLinked() as never,
		undefined,
		progressService,
	);

	// Discord reported the completion earlier and it was recorded.
	repositories.saveProgress({
		discord_user_id: 'user-1',
		quest_id: 'fading',
		status: QuestEligibility.COMPLETED,
		value: 60,
		target: 60,
		percent: 100,
		enrolled_at: PAST,
		completed_at: PAST,
		claimed_at: null,
	});

	// The catalogue snapshot has no user status (the live source lost it).
	const detail = await questService.status('fading', SCOPE);

	assert.equal(detail.eligibility, QuestEligibility.COMPLETED);
	assert.equal(detail.progress?.completedAt, PAST);
	assert.equal(detail.progress?.percent, 100);
});

test('the progress transition is written to the history', async (t) => {
	const db = new Database(':memory:');
	t.after(() => db.close());
	db.migrate();
	const repositories = new Repositories(db);
	const progressService = new ProgressService(repositories);

	const started = toQuestViewFromPayload(
		shape('h1', { enrolledAt: PAST, value: 30, target: 60 }),
	);
	progressService.record('user-1', started);

	const finished = toQuestViewFromPayload(
		shape('h1', { completedAt: PAST }),
	);
	progressService.record('user-1', finished);

	const stored = repositories.getProgress('user-1', 'h1');
	assert.equal(stored?.status, QuestEligibility.COMPLETED);
	assert.equal(stored?.percent, 100);

	const history = repositories.listHistory('user-1');
	assert.ok(history.some((entry) => entry.event_type === 'tracked'));
	assert.ok(history.some((entry) => entry.event_type === 'progress'));
});

// -------------------------------------------- refresh & stale catalogue

test('refresh reloads the catalogue file and triggers the hook', async (t) => {
	const { file, catalog } = tempCatalogue(t, ['r1']);
	const db = new Database(':memory:');
	t.after(() => db.close());
	db.migrate();
	const repositories = new Repositories(db);
	const progressService = new ProgressService(repositories);
	const questService = new QuestService(
		repositories,
		catalog,
		fakeLinked() as never,
		undefined,
		progressService,
	);

	let hookCalls = 0;
	questService.onRefresh = () => {
		hookCalls++;
	};

	const first = await questService.refresh(SCOPE);
	assert.equal(first.quests.length, 1);

	// The file changes on disk - the old cache must not hide the new quest.
	writeCatalogue(file, ['r1', 'r2']);

	const second = await questService.refresh(SCOPE);
	assert.equal(second.quests.length, 2, 'the reloaded file is picked up');
	assert.equal(hookCalls, 2, 'the notifier hook runs after every refresh');
	assert.ok(
		repositories
			.listQuestRecords()
			.some((record) => record.quest_id === 'r2'),
	);
});

test('refresh aggregates the quests of every account', async (t) => {
	const { catalog } = tempCatalogue(t, []);
	const db = new Database(':memory:');
	t.after(() => db.close());
	db.migrate();
	const repositories = new Repositories(db);
	const progressService = new ProgressService(repositories);

	const autoService = {
		listAllLiveQuests: async () => [
			{ account: 'acc-1', quests: [shape('only-a')], error: null },
			{ account: 'acc-2', quests: [shape('only-b')], error: null },
		],
	} as never;

	const questService = new QuestService(
		repositories,
		catalog,
		fakeLinked() as never,
		autoService,
		progressService,
	);

	const result = await questService.refresh(SCOPE);
	const ids = result.quests.map((quest) => quest.id).sort();

	assert.deepEqual(ids, ['only-a', 'only-b'], 'both accounts are kept');
	assert.equal(result.live, true);
	assert.ok(result.source.includes('acc-1'));
	assert.ok(result.source.includes('acc-2'));
});

test('a throwing live source falls back to the catalogue', async (t) => {
	const { catalog } = tempCatalogue(t, ['safe-fallback']);
	const db = new Database(':memory:');
	t.after(() => db.close());
	db.migrate();
	const repositories = new Repositories(db);

	const throwing = {
		listLiveQuests: async () => {
			throw new Error('network is down');
		},
	} as never;

	const questService = new QuestService(
		repositories,
		catalog,
		fakeLinked() as never,
		throwing,
	);

	const result = await questService.list(SCOPE);

	assert.equal(result.source, 'catalogue');
	assert.equal(result.quests.length, 1);
});
