import test from 'node:test';
import assert from 'node:assert/strict';

import { verifiedMediaUrl } from '../bot/utils/media';
import { mediaFromQuest } from '../bot/services/questAdapter';
import {
	buildAnnouncementRow,
	buildMembershipRow,
} from '../bot/ui/components';
import {
	membershipRequiredEmbed,
	questAnnouncementEmbed,
	verifiedInviteUrl,
} from '../bot/ui/embeds';
import { QuestEligibility } from '../bot/models/enums';
import type { QuestDetail } from '../bot/models/quest';
import { Quest } from '../src/quest';

function questWithMedia(config: Record<string, unknown>) {
	return Quest.create({ id: 'media', config } as never);
}

function detail(overrides: Partial<QuestDetail> = {}): QuestDetail {
	return {
		id: 'media',
		name: 'Media Quest',
		applicationId: null,
		applicationName: null,
		gameTitle: 'Game',
		publisher: null,
		contentType: 0,
		platforms: [],
		tasks: [],
		taskTypes: [],
		eligibility: QuestEligibility.AVAILABLE,
		progress: null,
		rewards: [],
		expiresAt: null,
		startsAt: null,
		source: 'catalogue',
		live: false,
		imageUrl: null,
		description: null,
		sharePolicy: null,
		ctaLabel: null,
		ctaLink: null,
		videoUrl: null,
		thumbnailUrl: null,
		...overrides,
	};
}

test('relative Discord assets are expanded with the official CDN', () => {
	assert.equal(
		verifiedMediaUrl('/assets/hero.png', 'image'),
		'https://cdn.discordapp.com/assets/hero.png',
	);
	assert.equal(
		verifiedMediaUrl('//assets/hero.webp', 'image'),
		'https://cdn.discordapp.com/assets/hero.webp',
	);
});

test('only https Discord media urls survive validation', () => {
	assert.equal(
		verifiedMediaUrl('https://cdn.discordapp.com/videos/a.mp4', 'video'),
		'https://cdn.discordapp.com/videos/a.mp4',
	);
	assert.equal(verifiedMediaUrl('http://cdn.discordapp.com/a.png', 'image'), null);
	assert.equal(verifiedMediaUrl('https://evil.example/a.png', 'image'), null);
	assert.equal(verifiedMediaUrl('javascript:alert(1)', 'image'), null);
	assert.equal(verifiedMediaUrl('/assets/hero.mp4', 'image'), null);
	assert.equal(verifiedMediaUrl(null, 'video'), null);
});

test('promo media comes only from the official catalogue fields', () => {
	const quest = questWithMedia({
		assets: {
			hero: '/assets/hero.png',
			hero_video: 'https://cdn.discordapp.com/assets/hero.mp4',
		},
		video_metadata: {
			assets: {
				video_player_video: 'https://media.discordapp.net/player.webm',
				video_player_thumbnail: '/assets/thumb.jpg',
			},
		},
	});

	const media = mediaFromQuest(quest);
	assert.equal(media.videoUrl, 'https://media.discordapp.net/player.webm');
	assert.equal(media.thumbnailUrl, 'https://cdn.discordapp.com/assets/thumb.jpg');
});

test('a third-party promo url is dropped and the embed still renders', () => {
	const quest = questWithMedia({
		assets: {
			hero: 'https://attacker.example/banner.png',
			hero_video: 'https://attacker.example/promo.mp4',
		},
	});

	const media = mediaFromQuest(quest);
	assert.equal(media.videoUrl, null);

	const embed = questAnnouncementEmbed(detail(), { nonce: 'nonce-1' });
	const json = embed.toJSON() as {
		footer?: { text?: string };
		fields?: { name: string; value: string }[];
	};
	assert.ok(json.footer?.text?.includes('Quest Completer'));
	assert.ok(json.footer?.text?.includes('ref nonce-1'));
	assert.ok(
		json.fields?.some((field) => field.name === 'Media'),
		'neutral fallback should explain that no media was published',
	);

	const row = buildAnnouncementRow(detail(), { videosEnabled: false });
	assert.ok(!JSON.stringify(row.toJSON()).includes('Watch Promo'));
});

test('a verified video becomes a button and a field', () => {
	const url = 'https://cdn.discordapp.com/assets/promo.mp4';
	const embed = questAnnouncementEmbed(
		detail({ videoUrl: url, imageUrl: null }),
	);
	const json = embed.toJSON() as {
		fields?: { name: string; value: string }[];
	};
	assert.ok(json.fields?.some((field) => field.value.includes(url)));

	const row = buildAnnouncementRow(detail({ videoUrl: url }));
	assert.ok(JSON.stringify(row.toJSON()).includes('Watch Promo'));
});

test('membership denial only links to verified Discord invites', () => {
	assert.equal(verifiedInviteUrl('https://discord.gg/abc'), 'https://discord.gg/abc');
	assert.equal(
		verifiedInviteUrl('https://discord.com/invite/abc'),
		'https://discord.com/invite/abc',
	);
	assert.equal(verifiedInviteUrl('https://evil.example/abc'), null);
	assert.equal(verifiedInviteUrl('http://discord.gg/abc'), null);

	assert.equal(buildMembershipRow('https://evil.example/abc'), null);
	const embed = membershipRequiredEmbed('https://discord.gg/abc').toJSON() as {
		description?: string;
	};
	assert.ok(embed.description?.includes('https://discord.gg/abc'));
	assert.equal(
		membershipRequiredEmbed(null).toJSON().description?.includes('Join:'),
		false,
	);
});
