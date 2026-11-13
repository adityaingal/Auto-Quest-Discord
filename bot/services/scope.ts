/**
 * The scope of a command.
 *
 * Everything a command reads or writes is filtered by the scope, so a user
 * can only ever reach their own data. The scope carries the Discord user id
 * and the flag that says whether the caller may also use the operator level
 * accounts (the tokens that are registered with `/token add`).
 */
export type AccountScope = {
	/** The Discord user that ran the command. */
	userId: string;
	/** True when the caller may use the operator level accounts. */
	isOperator: boolean;
};

/** The scope of the tests and of the background jobs. */
export const OPERATOR_SCOPE: AccountScope = {
	userId: 'operator',
	isOperator: true,
};

/**
 * The key the per user settings are stored under. Every user gets their own
 * key, so one user can never change the selection of another one.
 */
export function scopeKey(scope: AccountScope): string {
	return `account.${scope.userId}`;
}
