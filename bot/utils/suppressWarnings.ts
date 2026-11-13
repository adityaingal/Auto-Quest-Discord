/**
 * node:sqlite is still flagged as experimental. The warning is noise for
 * users, so it is filtered out before anything else is imported.
 */
const emitWarning = process.emitWarning.bind(process);

process.emitWarning = ((
	warning: string | Error,
	...args: unknown[]
) => {
	if (String(warning).includes('SQLite is an experimental feature')) return;
	(emitWarning as (w: string | Error, ...a: unknown[]) => void)(
		warning,
		...args,
	);
}) as typeof process.emitWarning;

export {};
