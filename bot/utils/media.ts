/**
 * Quest promotional media is accepted only when Discord itself published it.
 * Nothing here guesses a URL: a relative CDN asset is expanded with Discord's
 * documented CDN base, and an absolute URL must use https on a Discord host.
 */

const CDN_BASE = 'https://cdn.discordapp.com/';

const OFFICIAL_HOSTS = new Set([
	'cdn.discordapp.com',
	'discordapp.com',
	'discord.com',
	'media.discordapp.net',
	'www.discordapp.com',
	'www.discord.com',
]);

const EXTENSIONS = {
	image: /\.(?:png|jpe?g|gif|webp)(?:\?.*)?$/i,
	video: /\.(?:mp4|webm|m3u8)(?:\?.*)?$/i,
} as const;

export type MediaKind = keyof typeof EXTENSIONS;

/**
 * Returns a validated, https-only Discord media URL, or null. Invalid,
 * unsupported and third-party URLs are dropped - the caller must still work
 * without them.
 */
export function verifiedMediaUrl(
	raw: string | null | undefined,
	kind: MediaKind,
): string | null {
	const value = raw?.trim();
	if (!value) return null;

	try {
		const url = new URL(value.startsWith('/') ? `${CDN_BASE}${value.replace(/^\/+/, '')}` : value);

		if (url.protocol !== 'https:') return null;
		if (!OFFICIAL_HOSTS.has(url.hostname.toLowerCase())) return null;
		if (!EXTENSIONS[kind].test(url.pathname)) return null;

		return url.toString();
	} catch {
		return null;
	}
}
