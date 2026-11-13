import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoService } from '../bot/services/autoService';
import type { UserSession } from '../bot/integrations/userSession';

function quest(
	tasks: Record<string, { target: number }>,
	expiresInMs = 3600_000,
	id = 'quest-1',
	name = 'Test Quest',
) {
	return {
		id,
		config: {
			messages: { quest_name: name },
			application: { id: 'app-1', name: 'Game' },
			task_config_v2: { tasks },
			rewards_config: { rewards: [], platforms: [0] },
			expires_at: new Date(Date.now() + expiresInMs).toISOString(),
		},
		user_status: null,
	} as never;
}

/**
 * A user session that only records what it was asked to do - the tests must
 * not talk to Discord.
 */
class FakeSession {
	readonly calls: { at: number; timestamp: number }[] = [];
	readonly enrolled: { at: number; questId: string }[] = [];

	constructor(
		private readonly label: string,
		private readonly quests: unknown[] = [],
	) {}

	async whoami() {
		return {
			ok: true,
			status: 200,
			data: { id: `id-${this.label}`, username: this.label },
			error: null,
		};
	}

	async listQuests() {
		return {
			ok: true,
			status: 200,
			data: { quests: this.quests },
			error: null,
		};
	}

	async enroll(questId: string) {
		this.enrolled.push({ at: Date.now(), questId });
		return { ok: true, status: 200, data: {}, error: null };
	}

	async videoProgress(questId: string, timestamp: number) {
		this.calls.push({ at: Date.now(), timestamp });
		return { ok: true, status: 200, data: {}, error: null };
	}

	async heartbeat() {
		return { ok: true, status: 200, data: {}, error: null };
	}

	asSession(): UserSession {
		return this as unknown as UserSession;
	}
}

test('a playable task is preferred over console only tasks', () => {
	const resolved = AutoService.resolveTask(
		quest({
			PLAY_ON_XBOX: { target: 900 },
			PLAY_ON_PLAYSTATION: { target: 900 },
			PLAY_ON_DESKTOP: { target: 900 },
		}),
	);

	assert.equal(resolved.type, 'PLAY_ON_DESKTOP');
	assert.equal(resolved.target, 900);
});

test('a video task is preferred over console only tasks', () => {
	const resolved = AutoService.resolveTask(
		quest({
			PLAY_ON_XBOX: { target: 900 },
			WATCH_VIDEO: { target: 40 },
		}),
	);

	assert.equal(resolved.type, 'WATCH_VIDEO');
	assert.equal(resolved.target, 40);
});

test('tasks from task_config and task_config_v2 are merged', () => {
	const payload = {
		id: 'quest-1',
		config: {
			messages: { quest_name: 'Test Quest' },
			application: { id: 'app-1', name: 'Game' },
			task_config: { tasks: { WATCH_VIDEO: { target: 29 } } },
			task_config_v2: { tasks: { WATCH_VIDEO_ON_MOBILE: { target: 29 } } },
			rewards_config: { rewards: [], platforms: [0] },
			expires_at: new Date(Date.now() + 3600_000).toISOString(),
		},
		user_status: null,
	} as never;

	const resolved = AutoService.resolveTask(payload);
	assert.equal(resolved.type, 'WATCH_VIDEO');
	assert.equal(resolved.target, 29);
});

test('a console only quest reports the task it cannot automate', () => {
	const resolved = AutoService.resolveTask(
		quest({ PLAY_ON_XBOX: { target: 900 } }),
	);

	assert.equal(resolved.type, 'PLAY_ON_XBOX');
});

test('an expired quest is refused before anything is sent', async () => {
	const service = new AutoService(() => []);
	const result = await service.run(quest({ WATCH_VIDEO: { target: 40 } }, -1000));

	assert.equal(result.finished, false);
	assert.ok(result.message.includes('expired'));
});

test('without a session the automation explains itself', async () => {
	const service = new AutoService(() => []);
	const result = await service.run(quest({ WATCH_VIDEO: { target: 40 } }));

	assert.equal(result.finished, false);
	assert.ok(result.message.includes('/token add'));
});

test('the enabled flag follows the session list', () => {
	assert.equal(new AutoService(() => []).enabled, false);
	assert.equal(
		new AutoService(() => [
			{ label: 'main', session: null as never },
		]).enabled,
		true,
	);
});

test('the plan holds the quests of every account', async () => {
	const first = new FakeSession('first', [quest({ WATCH_VIDEO: { target: 40 } })]);
	const second = new FakeSession('second', [
		quest({ WATCH_VIDEO: { target: 40 } }, 3600_000, 'quest-2', 'Second'),
	]);

	const service = new AutoService(() => [
		{ label: 'first', session: first.asSession() },
		{ label: 'second', session: second.asSession() },
	]);

	const plan = await service.planQueue();

	assert.equal(plan.length, 2);
	assert.deepEqual(
		plan.map((job) => job.account).sort(),
		['first', 'second'],
	);
});

test('the quests of all accounts start at the same time', async () => {
	const first = new FakeSession('first', [quest({ WATCH_VIDEO: { target: 6 } })]);
	const second = new FakeSession('second', [
		quest({ WATCH_VIDEO: { target: 6 } }, 3600_000, 'quest-2', 'Second'),
	]);

	const service = new AutoService(() => [
		{ label: 'first', session: first.asSession() },
		{ label: 'second', session: second.asSession() },
	]);

	const summary = await service.runAll();

	assert.equal(summary.completed, 2);
	assert.equal(summary.failed, 0);
	assert.deepEqual(summary.accounts, ['first', 'second']);

	// Both accounts were enrolled at the same moment...
	const enrollGap = Math.abs(
		first.enrolled[0].at - second.enrolled[0].at,
	);
	assert.ok(enrollGap < 1000, `the enrolment was ${enrollGap}ms apart`);

	// ...and their quests ran at the same time instead of one after the
	// other.
	assert.ok(
		first.calls[0].at <= second.calls[second.calls.length - 1].at,
		'the quests did not run in parallel',
	);
	assert.ok(
		second.calls[0].at <= first.calls[first.calls.length - 1].at,
		'the quests did not run in parallel',
	);
});

test('the queue only works on the selected account', async () => {
	const first = new FakeSession('first', [quest({ WATCH_VIDEO: { target: 6 } })]);
	const second = new FakeSession('second', [
		quest({ WATCH_VIDEO: { target: 6 } }, 3600_000, 'quest-2', 'Second'),
	]);

	const service = new AutoService(() => [
		{ label: 'first', session: first.asSession() },
		{ label: 'second', session: second.asSession() },
	]);

	const summary = await service.runAll(undefined, { account: 'second' });

	assert.equal(summary.completed, 1);
	assert.deepEqual(summary.accounts, ['second']);
	assert.equal(first.calls.length, 0);
	assert.ok(second.calls.length > 0);
});

test('an unknown account is never silently replaced by another one', async () => {
	const first = new FakeSession('first', [quest({ WATCH_VIDEO: { target: 40 } })]);

	const service = new AutoService(() => [
		{ label: 'first', session: first.asSession() },
	]);

	const result = await service.run(
		quest({ WATCH_VIDEO: { target: 40 } }),
		'nope',
	);

	assert.equal(result.finished, false);
	assert.ok(result.message.includes('nope'));
	assert.equal(first.calls.length, 0);
	assert.throws(() => service.resolveAccount('nope'));
});

test('the selected account can be switched and is remembered', () => {
	let stored: string | null = null;

	const first = new FakeSession('first');
	const second = new FakeSession('second');

	const service = new AutoService(
		() => [
			{ label: 'first', session: first.asSession() },
			{ label: 'second', session: second.asSession() },
		],
		{
			readDefaultAccount: () => stored,
			writeDefaultAccount: (label) => {
				stored = label;
			},
		},
	);

	assert.equal(service.defaultAccount, null);

	service.setDefaultAccount('second');

	assert.equal(stored, 'second');
	assert.equal(service.defaultAccount, 'second');
	assert.equal(service.resolveAccount(), 'second');
	assert.equal(service.resolveAccount('first'), 'first');

	// "all" clears the selection - every account is used again.
	service.setDefaultAccount(null);
	assert.equal(service.defaultAccount, null);
	assert.equal(service.resolveAccount(), null);
});
