/**
 * Centralised enums for quests, platforms, content types and rewards.
 * Values match Discord's quest API (see docs/PROTOCOL.md).
 */

export enum QuestTaskType {
	WATCH_VIDEO = 'WATCH_VIDEO',
	PLAY_ON_DESKTOP = 'PLAY_ON_DESKTOP',
	STREAM_ON_DESKTOP = 'STREAM_ON_DESKTOP',
	PLAY_ACTIVITY = 'PLAY_ACTIVITY',
	WATCH_VIDEO_ON_MOBILE = 'WATCH_VIDEO_ON_MOBILE',
	PLAY_ON_XBOX = 'PLAY_ON_XBOX',
	PLAY_ON_PLAYSTATION = 'PLAY_ON_PLAYSTATION',
	ACHIEVEMENT_IN_GAME = 'ACHIEVEMENT_IN_GAME',
	ACHIEVEMENT_IN_ACTIVITY = 'ACHIEVEMENT_IN_ACTIVITY',
}

/** Task types this bot can reason about (read-only reporting). */
export const READABLE_TASK_TYPES: QuestTaskType[] = [
	QuestTaskType.WATCH_VIDEO,
	QuestTaskType.WATCH_VIDEO_ON_MOBILE,
	QuestTaskType.PLAY_ON_DESKTOP,
	QuestTaskType.STREAM_ON_DESKTOP,
	QuestTaskType.PLAY_ACTIVITY,
	QuestTaskType.PLAY_ON_XBOX,
	QuestTaskType.PLAY_ON_PLAYSTATION,
	QuestTaskType.ACHIEVEMENT_IN_GAME,
	QuestTaskType.ACHIEVEMENT_IN_ACTIVITY,
];

export enum QuestPlatformType {
	CROSS_PLATFORM = 0,
	XBOX = 1,
	PLAYSTATION = 2,
	SWITCH = 3,
	PC = 4,
}

export const PLATFORM_NAMES: Record<number, string> = {
	[QuestPlatformType.CROSS_PLATFORM]: 'Cross-platform',
	[QuestPlatformType.XBOX]: 'Xbox',
	[QuestPlatformType.PLAYSTATION]: 'PlayStation',
	[QuestPlatformType.SWITCH]: 'Nintendo Switch',
	[QuestPlatformType.PC]: 'PC',
};

export enum QuestContentType {
	GIFT_INVENTORY_SETTINGS_BADGE = 0,
	QUEST_BAR = 1,
	QUEST_INVENTORY_CARD = 2,
	QUESTS_EMBED = 3,
	ACTIVITY_PANEL = 4,
	QUEST_LIVE_STREAM = 5,
	MEMBERS_LIST = 6,
	QUEST_BADGE = 7,
	GIFT_INVENTORY_FOR_YOU = 8,
	GIFT_INVENTORY_OTHER = 9,
	QUEST_BAR_V2 = 10,
	QUEST_HOME_DESKTOP = 11,
	QUEST_HOME_MOBILE = 12,
	QUEST_BAR_MOBILE = 13,
	THIRD_PARTY_APP = 14,
	QUEST_BOTTOM_SHEET = 15,
	REWARD_MODAL = 25,
}

export enum QuestRewardType {
	REWARD_CODE = 1,
	IN_GAME = 2,
	COLLECTIBLE = 3,
	VIRTUAL_CURRENCY = 4,
	FRACTIONAL_PREMIUM = 5,
}

export const REWARD_TYPE_NAMES: Record<number, string> = {
	[QuestRewardType.REWARD_CODE]: 'Redeemable code',
	[QuestRewardType.IN_GAME]: 'In-game item',
	[QuestRewardType.COLLECTIBLE]: 'Collectible (decoration)',
	[QuestRewardType.VIRTUAL_CURRENCY]: 'Discord Orbs',
	[QuestRewardType.FRACTIONAL_PREMIUM]: 'Fractional Nitro',
};

export enum QuestEligibility {
	AVAILABLE = 'available',
	ENROLLED = 'enrolled',
	IN_PROGRESS = 'in-progress',
	COMPLETED = 'completed',
	UNAVAILABLE = 'unavailable',
}

export const ELIGIBILITY_LABELS: Record<QuestEligibility, string> = {
	[QuestEligibility.AVAILABLE]: 'Available',
	[QuestEligibility.ENROLLED]: 'Enrolled',
	[QuestEligibility.IN_PROGRESS]: 'In progress',
	[QuestEligibility.COMPLETED]: 'Completed',
	[QuestEligibility.UNAVAILABLE]: 'Unavailable',
};
