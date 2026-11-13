/**
 * Every error that can reach a Discord interaction carries a message that is
 * safe (and useful) to show to the user.
 */
export class AppError extends Error {
	public readonly userMessage: string;
	public readonly code: string;

	constructor(message: string, userMessage: string, code = 'APP_ERROR') {
		super(message);
		this.name = 'AppError';
		this.userMessage = userMessage;
		this.code = code;
	}
}

export class ConfigError extends AppError {
	constructor(message: string) {
		super(message, message, 'CONFIG_ERROR');
		this.name = 'ConfigError';
	}
}

export class PermissionError extends AppError {
	constructor(message = 'You are not allowed to use this command.') {
		super(message, message, 'PERMISSION_DENIED');
		this.name = 'PermissionError';
	}
}

export class NotFoundError extends AppError {
	constructor(message: string) {
		super(message, message, 'NOT_FOUND');
		this.name = 'NotFoundError';
	}
}

export class ValidationError extends AppError {
	constructor(message: string) {
		super(message, message, 'VALIDATION_ERROR');
		this.name = 'ValidationError';
	}
}

export class DatabaseError extends AppError {
	constructor(message: string, cause?: unknown) {
		super(message, 'The database is currently unavailable.', 'DB_ERROR');
		this.name = 'DatabaseError';
		if (cause) this.stack = `${this.stack}\n${String(cause)}`;
	}
}

/**
 * Raised when a Discord endpoint that would be required is not available for
 * bot accounts. We never fake the result - we say plainly that it cannot be
 * done from here.
 */
export class IntegrationUnavailableError extends AppError {
	constructor(feature: string, reason: string) {
		super(
			`${feature} is unavailable: ${reason}`,
			`${feature} is not available from a bot account. ${reason}`,
			'INTEGRATION_UNAVAILABLE',
		);
		this.name = 'IntegrationUnavailableError';
	}
}

export class AuthorizationError extends AppError {
	constructor(message: string) {
		super(
			message,
			'Your account authorization is missing, expired or revoked. Use `/account link` to reconnect.',
			'AUTH_ERROR',
		);
		this.name = 'AuthorizationError';
	}
}

export class RateLimitError extends AppError {
	constructor(retryAfter: number) {
		super(
			`Rate limited, retry after ${retryAfter}ms`,
			`Discord is rate limiting the bot. Try again in ${Math.ceil(retryAfter / 1000)} seconds.`,
			'RATE_LIMITED',
		);
		this.name = 'RateLimitError';
	}
}

export function toUserMessage(error: unknown): string {
	if (error instanceof AppError) return error.userMessage;

	if (error instanceof Error) {
		if (error.name === 'TokenInvalidError') {
			return 'The bot token was rejected by Discord.';
		}
		return 'Something went wrong while running that command.';
	}

	return 'Something went wrong while running that command.';
}
