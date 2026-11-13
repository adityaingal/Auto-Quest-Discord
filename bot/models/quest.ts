import { QuestEligibility } from './enums';

export type QuestTaskView = {
	type: string;
	target: number;
};

export type QuestRewardView = {
	name: string;
	type: number;
	orbQuantity: number | null;
	redemptionLink: string | null;
	instructions: string | null;
};

export type QuestProgressView = {
	value: number;
	target: number;
	percent: number;
	enrolledAt: string | null;
	completedAt: string | null;
	claimedAt: string | null;
};

export type QuestView = {
	id: string;
	name: string;
	applicationId: string | null;
	applicationName: string | null;
	gameTitle: string | null;
	publisher: string | null;
	contentType: number | null;
	platforms: number[];
	tasks: QuestTaskView[];
	taskTypes: string[];
	eligibility: QuestEligibility;
	progress: QuestProgressView | null;
	rewards: QuestRewardView[];
	expiresAt: string | null;
	startsAt: string | null;
	source: string;
	/** True when the data comes from a live Discord response. */
	live: boolean;
};

export type QuestDetail = QuestView & {
	description: string | null;
	sharePolicy: string | null;
	ctaLabel: string | null;
	ctaLink: string | null;
};
