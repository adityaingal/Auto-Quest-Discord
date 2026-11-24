import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoPilot, AutoPilotRunner } from '../bot/services/autoPilot';
import type { AutoRunSummary } from '../bot/services/autoService';
import type { QueueJob } from '../bot/services/autoService';
import { OPERATOR_SCOPE } from '../bot/services/scope';

function summary(overrides: Partial<AutoRunSummary> = {}): AutoRunSummary {
	return {
		completed: 1,
		failed: 1,
		skipped: 0,
		results: [
			{ quest: 'Good Quest', account: 'main', message: 'done', finished: true },
			{
				quest: 'Bad Quest',
				account: 'main',
				message: 'Enrolling failed: 401',
				finished: false,
			},
		],
		accounts: ['main'],
		...overrides,
	};
}

function job(id = 'quest-1'): QueueJob {
	return {
		account: 'main',
		quest: {
			id,
			config: {
				messages: { quest_name: id },
				application: { id: 'app-1', name: 'Game' },
				task_config_v2: { tasks: { WATCH_VIDEO: { target: 40 } } },
				rewards_config: { rewards: [], platforms: [0] },
				expires_at: new Date(Date.now() + 3600_000).toISOString(),
			},
			user_status: null,
		} as never,
	};
}

type Harness = {
	pilot: AutoPilot;
	sent: string[];
	runAllCalls: number;
	planCalls: number;
	running: boolean;
};

function makePilot(
	overrides: {
		enabled?: boolean;
		plan?: QueueJob[];
		summary?: AutoRunSummary;
		isRunning?: boolean;
	} = {},
): Harness {
	const sent: string[] = [];
	const state = {
		runAllCalls: 0,
		planCalls: 0,
		running: overrides.isRunning ?? false,
	};

	const auto: AutoPilotRunner = {
		isRunning: () => state.running,
		planQueue: async () => {
			state.planCalls++;
			return overrides.plan ?? [job()];
		},
		runAll: async () => {
			state.runAllCalls++;
			return overrides.summary ?? summary();
		},
	};

	const pilot = new AutoPilot({
		auto,
		notifier: {
			enabled: true,
			send: async (content: string) => {
				sent.push(content);
			},
		},
		enabled: overrides.enabled ?? true,
		scope: OPERATOR_SCOPE,
	});

	return {
		pilot,
		sent,
		get runAllCalls() {
			return state.runAllCalls;
		},
		get planCalls() {
			return state.planCalls;
		},
		get running() {
			return state.running;
		},
		set running(value: boolean) {
			state.running = value;
		},
	} as Harness;
}

test('the pilot is off when AUTO_PILOT=false and never sweeps', async () => {
	const harness = makePilot({ enabled: false });

	assert.equal(harness.pilot.enabled, false);
	assert.equal(await harness.pilot.sweep('startup'), null);
	assert.equal(harness.planCalls, 0, 'an off pilot must not plan');
	assert.equal(harness.sent.length, 0);
});

test('a sweep runs the plan and reports every failure with its reason', async () => {
	const harness = makePilot();

	const result = await harness.pilot.sweep('interval');

	assert.ok(result, 'the sweep returns the summary');
	assert.equal(harness.runAllCalls, 1);
	assert.equal(harness.sent.length, 1);

	const report = harness.sent[0];
	assert.ok(report.includes('Completed: **1**'));
	assert.ok(report.includes('Failed: **1**'));
	// The reason line that used to be invisible in "Failed: 8".
	assert.ok(report.includes('Enrolling failed: 401'));
	assert.ok(report.includes('Bad Quest'));
	assert.ok(report.includes('`main`'));
});

test('an empty plan means no run and no report', async () => {
	const harness = makePilot({ plan: [] });

	assert.equal(await harness.pilot.sweep('interval'), null);
	assert.equal(harness.runAllCalls, 0);
	assert.equal(harness.sent.length, 0);
});

test('a queue a user started by hand drops the sweep', async () => {
	const harness = makePilot({ isRunning: true });

	assert.equal(await harness.pilot.sweep('interval'), null);
	assert.equal(harness.planCalls, 0, 'the sweep must not even plan');
	assert.equal(harness.sent.length, 0);
});

test('a second sweep while one is running is dropped', async () => {
	const sent: string[] = [];
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});

	let runAllCalls = 0;
	const auto: AutoPilotRunner = {
		isRunning: () => false,
		planQueue: async () => [job()],
		runAll: async () => {
			runAllCalls++;
			await gate;
			return summary();
		},
	};

	const pilot = new AutoPilot({
		auto,
		notifier: {
			enabled: true,
			send: async (content: string) => {
				sent.push(content);
			},
		},
		enabled: true,
		scope: OPERATOR_SCOPE,
	});

	const first = pilot.sweep('interval');
	// Give the first sweep a tick to set its guard.
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(await pilot.sweep('interval'), null);

	release();
	await first;

	assert.equal(runAllCalls, 1, 'the second sweep must not run twice');
	assert.equal(sent.length, 1);
});

test('identical interval reports are not repeated', async () => {
	const sent: string[] = [];
	let current = summary();
	let planCalls = 0;

	const auto: AutoPilotRunner = {
		isRunning: () => false,
		planQueue: async () => {
			planCalls++;
			return [job()];
		},
		runAll: async () => current,
	};

	const pilot = new AutoPilot({
		auto,
		notifier: {
			enabled: true,
			send: async (content: string) => {
				sent.push(content);
			},
		},
		enabled: true,
		scope: OPERATOR_SCOPE,
		reportQuietMs: 0, // only the signature dedupe applies in this test
	});

	await pilot.sweep('interval');
	await pilot.sweep('interval');
	await pilot.sweep('interval');
	assert.equal(planCalls, 3, 'every tick still plans');
	assert.equal(sent.length, 1, 'the same result is only posted once');

	// A changed result is news and gets posted.
	current = summary({
		completed: 2,
		failed: 0,
		results: [
			{ quest: 'Good Quest', account: 'main', message: 'done', finished: true },
		],
	});
	await pilot.sweep('interval');
	assert.equal(sent.length, 2, 'a changed result is posted');
	assert.ok(sent[1].includes('Completed: **2**'));
});

test('a failing sweep is logged and never thrown', async () => {
	const auto: AutoPilotRunner = {
		isRunning: () => false,
		planQueue: async () => {
			throw new Error('discord exploded');
		},
		runAll: async () => summary(),
	};

	const pilot = new AutoPilot({
		auto,
		notifier: { enabled: false, send: async () => {} },
		enabled: true,
		scope: OPERATOR_SCOPE,
	});

	assert.equal(await pilot.sweep('startup'), null);
});

test('start() sweeps immediately and stop() ends the timer', async () => {
	const harness = makePilot({ plan: [] });

	harness.pilot.start(10);
	// The startup sweep runs immediately (fire and forget).
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(harness.planCalls, 1, 'the startup sweep plans once');

	// A second start must not add a second timer.
	harness.pilot.start(10);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(harness.planCalls, 1);

	harness.pilot.stop();
	harness.pilot.stop(); // idempotent
});

test('the pilot reports to the log when no channel is enabled', async () => {
	let sent = 0;
	const auto: AutoPilotRunner = {
		isRunning: () => false,
		planQueue: async () => [job()],
		runAll: async () => summary(),
	};

	const pilot = new AutoPilot({
		auto,
		notifier: { enabled: false, send: async () => void sent++ },
		enabled: true,
		scope: OPERATOR_SCOPE,
	});

	const result = await pilot.sweep('startup');
	assert.ok(result);
	assert.equal(sent, 0, 'a disabled notifier is never called');
});
