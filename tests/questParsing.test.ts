import test from 'node:test';
import assert from 'node:assert/strict';
import { Quest } from '../src/quest';
import type { Quest as QuestShape } from '../src/interface';

const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const PAST = new Date(Date.now() - 3600_000).toISOString();

function baseConfig(): Record<string, unknown> {
	return {
		id: '1',
		config_version: 2,
		starts_at: PAST,
		expires_at: FUTURE,
		features: [],
		application: { id: '10', name: 'Game', link: '' },
		assets: {
			hero: '',
			hero_video: null,
			quest_bar_hero: '',
			quest_bar_hero_video: null,
			game_tile: '',
			logotype: '',
		},
		colors: { primary: '#000000', secondary: '#000000' },
		messages: {
			quest_name: 'Test Quest',
			game_title: 'Test Game',
			game_publisher: 'Publisher',
		},
		rewards_config: {
			assignment_method: 1,
			rewards: [
				{
					type: 4,
					sku_id: '1',
					messages: {
						name: '700 Orbs',
						name_with_article: '700 Orbs',
						redemption_instructions_by_platform: { '0': 'Redeem it' },
					},
					orb_quantity: 700,
				},
			],
			rewards_expire_at: null,
			platforms: [0],
		},
	};
}

function makeQuest(
	configOverrides: Record<string, unknown>,
	userStatus: QuestShape['user_status'] = null,
): Quest {
	const shape = {
		id: 'quest-1',
		config: { ...baseConfig(), ...configOverrides },
		user_status: userStatus,
		targeted_content: [],
		preview: false,
	} as unknown as QuestShape;

	return Quest.create(shape);
}

test('reads the task from task_config (legacy quests)', () => {
	const quest = makeQuest({
		task_config: {
			type: 1,
			join_operator: 'and',
			tasks: { WATCH_VIDEO: { event_name: 'WATCH_VIDEO', target: 900 } },
		},
	});

	assert.equal(quest.taskType, 'WATCH_VIDEO');
	assert.equal(quest.taskTarget, 900);
	assert.deepEqual(quest.availableTaskTypes, ['WATCH_VIDEO']);
});

test('reads the task from task_config_v2 (current quests)', () => {
	const quest = makeQuest({
		task_config_v2: {
			join_operator: 'and',
			tasks: {
				PLAY_ON_DESKTOP: {
					event_name: 'PLAY_ON_DESKTOP',
					target: 900,
				},
			},
		},
	});

	assert.equal(quest.taskType, 'PLAY_ON_DESKTOP');
	assert.equal(quest.taskTarget, 900);
	assert.deepEqual(quest.availableTaskTypes, ['PLAY_ON_DESKTOP']);
});

test('merges tasks from both configurations', () => {
	const quest = makeQuest({
		task_config: {
			tasks: { WATCH_VIDEO: { event_name: 'WATCH_VIDEO', target: 30 } },
		},
		task_config_v2: {
			tasks: {
				PLAY_ON_DESKTOP: {
					event_name: 'PLAY_ON_DESKTOP',
					target: 900,
				},
				PLAY_ON_XBOX: { event_name: 'PLAY_ON_XBOX', target: 900 },
			},
		},
	});

	assert.equal(quest.taskList.length, 3);
	assert.deepEqual(
		quest.availableTaskTypes.sort(),
		['PLAY_ON_DESKTOP', 'PLAY_ON_XBOX', 'WATCH_VIDEO'],
	);
});

test('returns no task when neither configuration is present', () => {
	const quest = makeQuest({});

	assert.equal(quest.taskType, undefined);
	assert.equal(quest.taskTarget, 0);
	assert.deepEqual(quest.availableTaskTypes, []);
});

test('reports the recorded progress of the current task', () => {
	const quest = makeQuest(
		{
			task_config_v2: {
				tasks: {
					PLAY_ON_DESKTOP: {
						event_name: 'PLAY_ON_DESKTOP',
						target: 900,
					},
				},
			},
		},
		{
			user_id: '1',
			enrolled_at: PAST,
			completed_at: null,
			claimed_at: null,
			progress: {
				PLAY_ON_DESKTOP: {
					event_name: 'PLAY_ON_DESKTOP',
					value: 450,
					updated_at: PAST,
					completed_at: null,
				},
			},
		},
	);

	assert.equal(quest.progress, 450);
	assert.equal(quest.taskTarget, 900);
	assert.equal(quest.isEnrolledQuest(), true);
	assert.equal(quest.isCompleted(), false);
});

test('detects expiry, completion and claims', () => {
	const expired = makeQuest({
		expires_at: PAST,
		task_config_v2: { tasks: { WATCH_VIDEO: { target: 10 } } },
	});
	assert.equal(expired.isExpired(), true);

	const done = makeQuest(
		{ task_config_v2: { tasks: { WATCH_VIDEO: { target: 10 } } } },
		{
			user_id: '1',
			enrolled_at: PAST,
			completed_at: FUTURE,
			claimed_at: null,
			progress: {},
		},
	);
	assert.equal(done.isCompleted(), true);
	assert.equal(done.hasClaimedRewards(), false);

	done.updateUserStatus({
		user_id: '1',
		enrolled_at: PAST,
		completed_at: FUTURE,
		claimed_at: FUTURE,
		progress: {},
	});
	assert.equal(done.hasClaimedRewards(), true);
});
