import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Encrypts linked-account OAuth2 tokens before they are written to disk.
 * Never log or echo the plain text value.
 */
export class TokenVault {
	constructor(private readonly key: Buffer) {}

	encrypt(plainText: string): string {
		const iv = randomBytes(IV_LENGTH);
		const cipher = createCipheriv(ALGORITHM, this.key, iv);
		const encrypted = Buffer.concat([
			cipher.update(plainText, 'utf8'),
			cipher.final(),
		]);
		const tag = cipher.getAuthTag();

		return [iv, tag, encrypted]
			.map((part) => part.toString('base64url'))
			.join('.');
	}

	decrypt(payload: string): string {
		const [ivPart, tagPart, dataPart] = payload.split('.');

		if (!ivPart || !tagPart || !dataPart) {
			throw new Error('Malformed encrypted payload.');
		}

		const decipher = createDecipheriv(
			ALGORITHM,
			this.key,
			Buffer.from(ivPart, 'base64url'),
		);
		decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

		return Buffer.concat([
			decipher.update(Buffer.from(dataPart, 'base64url')),
			decipher.final(),
		]).toString('utf8');
	}

	/**
	 * Signs a short lived payload (used for the OAuth2 state). The signature
	 * lets a different instance of the bot verify it without a shared
	 * database - only the encryption key has to be the same.
	 */
	sign(payload: Record<string, unknown>): string {
		const body = Buffer.from(JSON.stringify(payload)).toString(
			'base64url',
		);
		const signature = createHmac('sha256', this.key)
			.update(body)
			.digest('base64url');

		return `${body}.${signature}`;
	}

	verify<T>(state: string): T | null {
		const [body, signature] = state.split('.');
		if (!body || !signature) return null;

		const expected = createHmac('sha256', this.key)
			.update(body)
			.digest('base64url');

		const given = Buffer.from(signature);
		const wanted = Buffer.from(expected);

		if (given.length !== wanted.length) return null;
		if (!timingSafeEqual(given, wanted)) return null;

		try {
			return JSON.parse(
				Buffer.from(body, 'base64url').toString('utf8'),
			) as T;
		} catch {
			return null;
		}
	}
}
