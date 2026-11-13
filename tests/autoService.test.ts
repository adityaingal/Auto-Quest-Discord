import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoService } from '../bot/services/autoService';

function quest(
	tasks: Record<string, { target: number }>,
	expiresInMs = 3600_000,
) {
	return {
		id: 'quest-1',
		config: {
			messages: { quest_name: 'Test Quest' },
			application: { id: 'app-1', name: 'Game' },
			task_config_v2: { tasks },
			rewards_config: { rewards: [], platforms: [0] },
			expires_at: new Date(Date.now() + expiresInMs).toISOString(),
		},
		user_status: null,
	} as never;
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
