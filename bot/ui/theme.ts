export const COLORS = {
	primary: 0x5865f2,
	success: 0x57f287,
	warning: 0xfee75c,
	danger: 0xed4245,
	neutral: 0x2b2d31,
	info: 0x3498db,
} as const;

export const EMOJI = {
	available: '🟢',
	enrolled: '🔵',
	inProgress: '🟡',
	completed: '✅',
	unavailable: '⚫',
} as const;

/**
 * Renders a text progress bar, e.g. ██████████░░░░░░░░░░ 50%
 */
export function renderProgressBar(percent: number, width = 20): string {
	const clamped = Math.min(100, Math.max(0, Math.round(percent)));
	const filled = Math.round((clamped / 100) * width);
	const empty = width - filled;

	return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${clamped}%`;
}

export function formatDuration(seconds: number): string {
	if (!seconds || seconds < 0) return '0s';

	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = Math.round(seconds % 60);

	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${rest}s`;
	return `${rest}s`;
}

export function relativeTime(iso: string | null): string {
	if (!iso) return 'never';

	const delta = Date.now() - new Date(iso).getTime();
	if (Number.isNaN(delta)) return 'unknown';

	const minutes = Math.round(delta / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;

	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;

	return `${Math.round(hours / 24)}d ago`;
}
