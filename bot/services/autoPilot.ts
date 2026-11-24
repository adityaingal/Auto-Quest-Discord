import { AutoService, AutoRunSummary } from './autoService';
import { AccountScope, OPERATOR_SCOPE } from './scope';
import { Logger } from '../utils/logger';

/** What made the pilot look for work right now. */
export type SweepTrigger = 'startup' | 'interval' | 'new-quest';

/**
 * The slice of AutoService the pilot needs. Structural, so the tests can
 * drive the whole sweep/report flow without Discord.
 */
export type AutoPilotRunner = Pick<
	AutoService,
	'isRunning' | 'planQueue' | 'runAll'
>;

/** The status channel the pilot reports to (Notifier / NOTIFY_CHANNEL_ID). */
export type AutoPilotNotifier = {
	readonly enabled: boolean;
	send(content: string): Promise<void>;
};

export type AutoPilotOptions = {
	auto: AutoPilotRunner;
	notifier: AutoPilotNotifier;
	/** AUTO_PILOT - false disables the pilot entirely. */
	enabled: boolean;
	/** The scope the sweeps run in - operator tokens, never a user's scope. */
	scope?: AccountScope;
	/** Minimum seconds between two *different* interval reports.
	 *  Injectable for the tests - production uses the default. */
	reportQuietMs?: number;
};

/** Two different interval reports at least this far apart (production). */
const REPORT_QUIET_MS = 60_000;

/**
 * Runs the runnable quests of the operator scope without anybody asking.
 *
 * Two triggers, both decided by this class:
 * - a **sweep** every `AUTO_PILOT_INTERVAL_SECONDS` (default 10s), and
 * - an **immediate** sweep when the public notifier discovers a new quest.
 *
 * Rules:
 * - Never overlaps: a sweep that is already running, or a queue a user
 *   started manually (`autoService.isRunning`), drops the tick.
 * - Every result is reported with a **reason line per failed quest**, so a
 *   "Failed: 8" is diagnosable from the channel alone.
 * - Reports to the same channel as the status notifier; identical interval
 *   summaries are throttled so a permanently failing quest cannot spam.
 * - Errors never crash the bot - the sweep logs and returns.
 */
export class AutoPilot {
	private timer: NodeJS.Timeout | null = null;
	private sweeping = false;
	private lastReportAt = 0;
	private lastSignature = '';
	private readonly quietMs: number;

	constructor(private readonly options: AutoPilotOptions) {
		this.quietMs = options.reportQuietMs ?? REPORT_QUIET_MS;
	}

	get enabled(): boolean {
		return this.options.enabled;
	}

	/** Starts the periodic sweep and runs one sweep right away. */
	start(intervalSeconds: number): void {
		if (this.timer) return;

		if (!this.enabled) {
			Logger.info('Auto-pilot disabled (AUTO_PILOT=false).');
			return;
		}

		// Ten seconds is the floor: every sweep talks to Discord, and a
		// faster loop would only earn a rate limit.
		const seconds = Number.isFinite(intervalSeconds)
			? Math.max(10, Math.floor(intervalSeconds))
			: 10;

		this.timer = setInterval(() => {
			void this.sweep('interval');
		}, seconds * 1000);

		Logger.info(
			`Auto-pilot started (every ${seconds}s, reporting to ${
				this.options.notifier.enabled ? 'NOTIFY_CHANNEL_ID' : 'the log only'
			})`,
		);

		void this.sweep('startup');
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	/**
	 * Plans the queue and runs it. Returns the summary, or null when there
	 * was nothing to do or the sweep was dropped. Never throws.
	 */
	async sweep(trigger: SweepTrigger): Promise<AutoRunSummary | null> {
		if (!this.enabled) return null;
		if (this.sweeping) return null;

		const scope = this.options.scope ?? OPERATOR_SCOPE;

		// A queue a user started by hand owns the sessions right now.
		if (this.options.auto.isRunning(scope)) {
			if (trigger !== 'interval') {
				Logger.info(
					'Auto-pilot: a quest queue is already running - waiting for the next sweep.',
				);
			}
			return null;
		}

		this.sweeping = true;
		try {
			const plan = await this.options.auto.planQueue(scope);

			if (plan.length === 0) {
				if (trigger !== 'interval') {
					Logger.info('Auto-pilot: nothing to run right now.');
				}
				return null;
			}

			Logger.info(
				`Auto-pilot sweep (${trigger}): ${plan.length} quest(s) queued.`,
			);

			const summary = await this.options.auto.runAll(scope, undefined, {
				plan,
			});

			await this.report(summary, trigger);
			return summary;
		} catch (error) {
			Logger.error(
				`Auto-pilot sweep failed: ${(error as Error).message}`,
			);
			return null;
		} finally {
			this.sweeping = false;
		}
	}

	/**
	 * Posts the run summary. Interval reports with an unchanged result are
	 * throttled, so a quest that fails the same way every ten seconds is
	 * reported once - not forever.
	 */
	private async report(
		summary: AutoRunSummary,
		trigger: SweepTrigger,
	): Promise<void> {
		const failures = summary.results.filter((entry) => !entry.finished);
		const signature = [
			summary.completed,
			summary.failed,
			summary.skipped,
			...failures.map((entry) => `${entry.account}:${entry.quest}:${entry.message}`),
		].join('|');

		const now = Date.now();

		// Interval reports are only sent when the result actually changed
		// and at most once a minute - startup and new-quest sweeps always
		// report, because those are events the operator asked for.
		const quiet =
			trigger === 'interval' &&
			(signature === this.lastSignature ||
				now - this.lastReportAt < this.quietMs);

		const shown = failures.slice(0, 8);
		const hidden = failures.length - shown.length;

		const lines = [
			`🤖 **Auto-pilot sweep** (${trigger})`,
			`Completed: **${summary.completed}** · Failed: **${summary.failed}** · Skipped: **${summary.skipped}**`,
			...shown.map(
				(entry) =>
					`⚠️ \`${entry.account}\` - ${entry.quest}: ${entry.message}`,
			),
			...(hidden > 0 ? [`…and ${hidden} more failure(s)`] : []),
		];

		// The log always gets the result - the channel gets it unless the
		// identical interval report was just sent.
		Logger.info(lines.join(' | ').replace(/\*\*|`/g, ''));

		if (quiet || !this.options.notifier.enabled) return;

		this.lastReportAt = now;
		this.lastSignature = signature;

		try {
			await this.options.notifier.send(lines.join('\n'));
		} catch (error) {
			Logger.warn(
				`Auto-pilot report failed: ${(error as Error).message}`,
			);
		}
	}
}
