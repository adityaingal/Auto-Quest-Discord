import chalk from 'chalk';
import { LogLevel } from '../config';

const ORDER: Record<LogLevel, number> = {
	DEBUG: 10,
	INFO: 20,
	WARN: 30,
	ERROR: 40,
};

export class Logger {
	private static level: LogLevel = 'INFO';

	static setLevel(level: LogLevel): void {
		Logger.level = level;
	}

	static getLevel(): LogLevel {
		return Logger.level;
	}

	static debug(message: string, context?: unknown): void {
		Logger.write('DEBUG', chalk.gray(message), context);
	}

	static info(message: string, context?: unknown): void {
		Logger.write('INFO', chalk.cyan(message), context);
	}

	static warn(message: string, context?: unknown): void {
		Logger.write('WARN', chalk.yellow(message), context);
	}

	static error(message: string, context?: unknown): void {
		Logger.write('ERROR', chalk.red(message), context);
	}

	private static write(
		level: LogLevel,
		formatted: string,
		context?: unknown,
	): void {
		if (ORDER[level] < ORDER[Logger.level]) return;

		const stamp = new Date().toISOString();
		const line = `${chalk.gray(stamp)} [${level}] ${formatted}`;

		if (level === 'ERROR' || level === 'WARN') {
			console.error(line);
		} else {
			console.log(line);
		}

		if (context !== undefined) {
			console.log(chalk.gray(JSON.stringify(context, null, 2)));
		}
	}
}
