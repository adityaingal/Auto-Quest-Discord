import type { Config } from '../config';
import type { Repositories } from '../database/repositories';

/**
 * Environment variables are the deployment defaults. The owner can override
 * every operational setting at runtime with `!admin config <key> <value>`;
 * the values live in the existing `bot_config` table and are therefore part
 * of every database backup.
 */
export const RUNTIME_SETTING_KEYS = [
	'quest_monitoring_enabled',
	'quest_monitor_interval_minutes',
	'public_quest_channel_id',
	'quest_images_enabled',
	'quest_videos_enabled',
	'quest_media_fallback',
	'membership_verification_enabled',
	'required_guild_id',
	'required_guild_invite',
	'membership_verify_interval_minutes',
	'membership_member_events',
	'webhook_backup_enabled',
	'webhook_backup_interval_minutes',
	'webhook_backup_max_mb',
] as const;

export type RuntimeSettings = {
	questMonitoringEnabled: boolean;
	questMonitorIntervalMinutes: number;
	publicQuestChannelId: string | null;
	questImagesEnabled: boolean;
	questVideosEnabled: boolean;
	questMediaFallback: 'neutral' | 'omit';
	membershipVerificationEnabled: boolean;
	requiredGuildId: string | null;
	requiredGuildInvite: string | null;
	membershipVerifyIntervalMinutes: number;
	membershipMemberEvents: boolean;
	webhookBackupEnabled: boolean;
	webhookBackupIntervalMinutes: number;
	webhookBackupMaxBytes: number;
};

function bool(value: string | undefined, fallback: boolean): boolean {
	const trimmed = value?.trim();
	if (!trimmed) return fallback;
	return !/^(false|0|off|no|none)$/i.test(trimmed);
}

function positiveInt(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0
		? Math.max(1, Math.floor(parsed))
		: fallback;
}

function nullable(value: string | undefined, fallback: string | null): string | null {
	if (value === undefined) return fallback;
	const trimmed = value.trim();
	if (!trimmed || /^none$/i.test(trimmed)) return null;
	return trimmed;
}

export function readRuntimeSettings(
	repositories: Repositories,
	config: Config,
): RuntimeSettings {
	const read = (key: string): string | undefined => repositories.getConfig(key);

	const requiredGuildId = nullable(
		read('required_guild_id'),
		config.requiredGuildId,
	);
	const membershipVerificationEnabled = bool(
		read('membership_verification_enabled'),
		config.membershipVerificationEnabled,
	) && Boolean(requiredGuildId);

	const fallback =
		read('quest_media_fallback')?.trim().toLowerCase() ??
		config.questMediaFallback;

	return {
		questMonitoringEnabled: bool(
			read('quest_monitoring_enabled'),
			config.questMonitoringEnabled,
		),
		questMonitorIntervalMinutes: positiveInt(
			read('quest_monitor_interval_minutes'),
			config.questMonitorIntervalMinutes,
		),
		publicQuestChannelId: nullable(
			read('public_quest_channel_id'),
			config.publicQuestChannelId,
		),
		questImagesEnabled: bool(
			read('quest_images_enabled'),
			config.questImagesEnabled,
		),
		questVideosEnabled: bool(
			read('quest_videos_enabled'),
			config.questVideosEnabled,
		),
		questMediaFallback: fallback === 'omit' ? 'omit' : 'neutral',
		membershipVerificationEnabled,
		requiredGuildId,
		requiredGuildInvite: nullable(
			read('required_guild_invite'),
			config.requiredGuildInvite,
		),
		membershipVerifyIntervalMinutes: positiveInt(
			read('membership_verify_interval_minutes'),
			config.membershipVerifyIntervalMinutes,
		),
		membershipMemberEvents: bool(
			read('membership_member_events'),
			config.membershipMemberEvents,
		),
		webhookBackupEnabled: bool(
			read('webhook_backup_enabled'),
			config.webhookBackupEnabled,
		),
		webhookBackupIntervalMinutes: positiveInt(
			read('webhook_backup_interval_minutes'),
			config.webhookBackupIntervalMinutes,
		),
		webhookBackupMaxBytes:
			positiveInt(
				read('webhook_backup_max_mb'),
				Math.floor(config.webhookBackupMaxBytes / (1024 * 1024)),
			) *
			1024 *
			1024,
	};
}
