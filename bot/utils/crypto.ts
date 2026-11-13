import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

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
}
