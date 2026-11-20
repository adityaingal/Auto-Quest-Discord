import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbedBuilder, type User } from 'discord.js';
import {
	COLORS,
	formatDuration,
	renderProgressBar,
	relativeTime,
} from '../bot/ui/theme';
import { errorEmbed, questDetailEmbed, questListEmbed } from '../bot/ui/embeds';
import {
	buildOwnerPanel,
	buildOwnerProfilePanel,
	OWNER_COMMANDS,
	OWNER_COMMAND_IDS,
	OWNER_PANEL_IDS,
	ownerCommandModal,
	ownerProfileModal,
} from '../bot/ui/panel';
import {
	AppError,
	ConfigError,
	IntegrationUnavailableError,
	PermissionError,
	toUserMessage,
} from '../bot/utils/errors';
import { loadConfig } from '../bot/config';
import { QuestEligibility } from '../bot/models/enums';
import { InteractionRouter } from '../bot/commands/interactions';
import { handlePrefixCommand } from '../bot/commands/prefix';

function questStub() {
	return {
		id: 'quest-1',
		name: 'Test Quest',
		applicationId: 'app-1',
		applicationName: 'Game',
		gameTitle: 'Game',
		publisher: 'Publisher',
		contentType: 11,
		platforms: [0],
		tasks: [{ type: 'PLAY_ON_DESKTOP', target: 900 }],
		taskTypes: ['PLAY_ON_DESKTOP'],
		eligibility: QuestEligibility.IN_PROGRESS,
		progress: {
			value: 450,
			target: 900,
			percent: 50,
			enrolledAt: null,
			completedAt: null,
			claimedAt: null,
		},
		rewards: [
			{
				name: '700 Orbs',
				type: 4,
				orbQuantity: 700,
				redemptionLink: null,
				instructions: null,
			},
		],
		expiresAt: new Date(Date.now() + 3600_000).toISOString(),
		startsAt: new Date(Date.now() - 3600_000).toISOString(),
		source: 'catalogue',
		live: false,
		imageUrl: null,
	};
}

test('the progress bar renders the percentage', () => {
	const bar = renderProgressBar(50, 10);

	assert.equal(bar.length, 14);
	assert.ok(bar.startsWith('█████░░░░░'));
	assert.ok(bar.endsWith('50%'));
});

test('the progress bar clamps out of range values', () => {
	assert.ok(renderProgressBar(-10).endsWith('0%'));
	assert.ok(renderProgressBar(180).endsWith('100%'));
});

test('durations are formatted', () => {
	assert.equal(formatDuration(0), '0s');
	assert.equal(formatDuration(45), '45s');
	assert.equal(formatDuration(90), '1m 30s');
	assert.equal(formatDuration(3700), '1h 1m');
});

test('relative time handles missing timestamps', () => {
	assert.equal(relativeTime(null), 'never');
	assert.equal(relativeTime(new Date().toISOString()), 'just now');
});

test('the quest list embed contains the quest names', () => {
	const embed = questListEmbed([questStub()], 'catalogue', false);
	const json = embed.toJSON();

	assert.equal(json.title, 'QUEST COMPLETER');
	assert.ok(
		JSON.stringify(json.fields).includes('Test Quest'),
		'quest name missing',
	);
});

test('the quest detail embed contains status, tasks and rewards', () => {
	const embed = questDetailEmbed({
		...questStub(),
		description: null,
		sharePolicy: null,
		ctaLabel: null,
		ctaLink: null,
	});
	const json = embed.toJSON();
	const text = JSON.stringify(json);

	assert.ok(text.includes('In progress'));
	assert.ok(text.includes('PLAY_ON_DESKTOP'));
	assert.ok(text.includes('700 Orbs'));
	assert.ok(text.includes('50%'));
});

test('an empty quest list renders a hint instead of crashing', () => {
	const embed = questListEmbed([], 'catalogue', false);
	assert.ok(embed.toJSON().description);
});

test('errors produce a user facing message', () => {
	assert.equal(
		toUserMessage(new PermissionError()),
		'You are not allowed to use this command.',
	);
	assert.ok(
		toUserMessage(
			new IntegrationUnavailableError('Live quest data', 'because'),
		).includes('not available'),
	);
	assert.ok(toUserMessage(new Error('internal detail')).length > 0);
	assert.ok(
		!toUserMessage(new Error('internal detail')).includes('internal detail'),
		'internal details must not leak to the user',
	);
	assert.ok(toUserMessage('weird').length > 0);
});

test('the error embed is a discord embed', () => {
	const embed = errorEmbed('nope');
	assert.ok(embed instanceof EmbedBuilder);
	assert.equal(embed.toJSON().color, COLORS.danger);
});

test('the owner profile panel shows the avatar and username', () => {
	const avatar = 'https://cdn.discordapp.com/avatars/123/abc.png';
	const user = {
		id: '123456789012345678',
		username: 'tester',
		displayAvatarURL: () => avatar,
	} as unknown as User;

	const payload = buildOwnerProfilePanel(user);
	const json = payload.embeds[0].toJSON();
	const components = JSON.stringify(
		payload.components.map((row) => row.toJSON()),
	);

	assert.ok(json.description?.includes('tester'));
	assert.equal(json.image?.url, avatar);
	assert.equal(json.thumbnail?.url, avatar);
	assert.ok(components.includes(OWNER_PANEL_IDS.input));
	assert.ok(components.includes(OWNER_PANEL_IDS.refresh));
});

test('the owner profile modal asks for a discord user id', () => {
	const json = ownerProfileModal().toJSON();

	assert.equal(json.custom_id, OWNER_PANEL_IDS.submit);
	assert.ok(JSON.stringify(json.components).includes(OWNER_PANEL_IDS.userId));
});

test('the owner panel lists every owner command across pages', () => {
	const menuOf = (page: number) => {
		const row = buildOwnerPanel(page).components[0].toJSON() as {
			components: {
				custom_id: string;
				options: { value: string }[];
			}[];
		};
		return row.components[0];
	};

	const first = menuOf(0);
	assert.ok(first.custom_id.startsWith(OWNER_COMMAND_IDS.select));
	assert.equal(first.options.length, 15);
	assert.ok(buildOwnerPanel(0).embeds[0].toJSON().title?.includes('OWNER'));

	const last = menuOf(999);
	assert.ok(last.options.length > 0);
	assert.ok(
		last.options.some(
			(option) => option.value === OWNER_COMMANDS[OWNER_COMMANDS.length - 1].id,
		),
	);
});

test('the owner panel builds a modal only for commands with inputs', () => {
	assert.equal(ownerCommandModal('admin.stats'), null);

	const modal = ownerCommandModal('room.create');
	assert.ok(modal);
	const json = modal.toJSON();
	assert.ok(json.custom_id.startsWith(OWNER_COMMAND_IDS.modal));
	assert.ok(JSON.stringify(json.components).includes('field_0'));
	assert.ok(JSON.stringify(json.components).includes('field_1'));
});

test('the owner panel select menu opens a modal', async () => {
	const router = new InteractionRouter({
		config: { ownerIds: ['1'] },
	} as never);
	let shown: { toJSON(): { custom_id: string } } | null = null;
	const interaction = {
		type: 3,
		customId: 'owner:panel_select:0',
		user: { id: '1' },
		values: ['room.create'],
		isStringSelectMenu: () => true,
		isRepliable: () => true,
		showModal: async (modal: { toJSON(): { custom_id: string } }) => {
			shown = modal;
		},
		reply: async () => undefined,
	} as never;

	await router.handle(interaction);

	assert.ok(shown, 'the modal was not shown');
	assert.equal(
		(shown as { toJSON(): { custom_id: string } }).toJSON().custom_id,
		'owner:panel_modal:room.create',
	);
});

test('the owner panel can be filtered to one command group', () => {
	const payload = buildOwnerPanel(0, 'whitelist');
	const row = payload.components[0].toJSON() as {
		components: {
			custom_id: string;
			options: { value: string }[];
		}[];
	};
	const menu = row.components[0];

	assert.ok(menu.custom_id.includes(':whitelist:'));
	assert.ok(menu.options.length > 0);
	assert.ok(menu.options.every((option) => option.value.startsWith('whitelist.')));
	assert.ok(String(payload.embeds[0].toJSON().title).includes('WHITELIST'));
});

test('an admin can use a filtered panel', async () => {
	const router = new InteractionRouter({
		config: { ownerIds: [] },
		adminService: { isWhitelistedAdmin: () => true },
	} as never);
	let shown: { toJSON(): { custom_id: string } } | null = null;
	const interaction = {
		type: 3,
		customId: 'owner:panel_select:whitelist:0',
		user: { id: 'admin' },
		values: ['whitelist.add'],
		isStringSelectMenu: () => true,
		isRepliable: () => true,
		showModal: async (modal: { toJSON(): { custom_id: string } }) => {
			shown = modal;
		},
		reply: async () => undefined,
	} as never;

	await router.handle(interaction);

	assert.ok(shown, 'the modal was not shown');
	assert.equal(
		(shown as { toJSON(): { custom_id: string } }).toJSON().custom_id,
		'owner:panel_modal:whitelist:whitelist.add',
	);
});

test('!whitelist open opens the whitelist panel for admins', async () => {
	let replied: { embeds?: unknown[] } | null = null;
	const services = {
		config: { prefix: '!', ownerIds: [] },
		adminService: { isWhitelistedAdmin: () => true },
		scopeFor: () => ({ userId: 'admin', isOperator: true }),
	} as never;
	const message = {
		author: { id: 'admin', bot: false },
		content: '!whitelist open',
		reply: async (payload: { embeds?: unknown[] }) => {
			replied = payload;
		},
	} as never;

	await handlePrefixCommand(message, services);

	assert.ok(replied, 'the panel was not sent');
	assert.ok(JSON.stringify((replied as { embeds?: unknown[] }).embeds).includes('WHITELIST'));
});

test('the config refuses to start without a bot token', () => {
	assert.throws(
		() =>
			loadConfig({
				DISCORD_CLIENT_ID: '1',
				ENCRYPTION_KEY: 'key',
				// do not read the local .env file
				DOTENV_PATH: '.env.does-not-exist',
			} as NodeJS.ProcessEnv),
		ConfigError,
	);
});

test('the config refuses to start without an encryption key', () => {
	// Without a key every stored token would be encrypted with a published
	// default, so the bot must not start at all.
	assert.throws(
		() =>
			loadConfig({
				DISCORD_BOT_TOKEN: 'token',
				DISCORD_CLIENT_ID: '1',
				DOTENV_PATH: '.env.does-not-exist',
			} as NodeJS.ProcessEnv),
		ConfigError,
	);
});

test('the config loads and defaults every optional value', () => {
	const config = loadConfig({
		DISCORD_BOT_TOKEN: 'token',
		DISCORD_CLIENT_ID: '123',
		ENCRYPTION_KEY: 'a-secret-that-is-long-enough',
		DOTENV_PATH: '.env.does-not-exist',
	} as NodeJS.ProcessEnv);

	assert.equal(config.botToken, 'token');
	assert.equal(config.clientId, '123');
	assert.equal(config.logLevel, 'INFO');
	assert.equal(config.notificationIntervalMinutes, 15);
	assert.equal(config.databasePath, 'data/quest-bot.sqlite');
	assert.equal(config.encryptionKey.length, 32);
});

test('the config parses several owners, comma separated', () => {
	const config = loadConfig({
		DISCORD_BOT_TOKEN: 'token',
		DISCORD_CLIENT_ID: '1',
		ENCRYPTION_KEY: 'a-secret-that-is-long-enough',
		OWNER_ID: '111, 222, 333',
		DOTENV_PATH: '.env.does-not-exist',
	} as NodeJS.ProcessEnv);

	assert.deepEqual(config.ownerIds, ['111', '222', '333']);
});

test('the encryption key differs between two secrets', () => {
	const first = loadConfig({
		DISCORD_BOT_TOKEN: 'token',
		DISCORD_CLIENT_ID: '1',
		ENCRYPTION_KEY: 'first-secret',
		DOTENV_PATH: '.env.does-not-exist',
	} as NodeJS.ProcessEnv);

	const second = loadConfig({
		DISCORD_BOT_TOKEN: 'token',
		DISCORD_CLIENT_ID: '1',
		ENCRYPTION_KEY: 'second-secret',
		DOTENV_PATH: '.env.does-not-exist',
	} as NodeJS.ProcessEnv);

	assert.notDeepEqual(first.encryptionKey, second.encryptionKey);
});
