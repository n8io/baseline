import { logger } from "@n8io/baseline-logger";

/**
 * One thing to close on shutdown: an intake (HTTP server, live streams, Event handlers) or a
 * resource (the queue, pools, clients, health, telemetry).
 */
export type ShutdownStep = { name: string; close: () => Promise<void> };

/** What `shutdownHandleCreate` closes, and how long it may take. */
export type ShutdownOptions = {
	/**
	 * When it gives up and exits, counted from the signal, drain delay included. Over 5000: the
	 * last 5 s belong to the resources. Default 25 000.
	 */
	deadlineMs?: number | null;
	/**
	 * How long readiness answers 503 before the intakes close, so load balancers notice. Under
	 * `deadlineMs` minus 5000, so the intakes get time to close. Default 5000; the Template reads
	 * `SHUTDOWN_DRAIN_DELAY_MS` and sets 0 in development.
	 */
	drainDelayMs?: number | null;
	/** Closed together; each stops accepting, then waits for its active work. */
	intakes: ShutdownStep[];
	/** Closed one by one, in order, after every intake is done; telemetry last. */
	resources: ShutdownStep[];
};

/** The running shutdown handle. `isShuttingDown()` turns true at the signal, for `/readyz`. */
export type ShutdownHandle = { isShuttingDown(): boolean };

// The last 5 s before the deadline belong to the resources.
const resourceReserveMs = 5000;
// The longest wait a timer takes (2^31 - 1 ms, about 24.8 days).
const timerMax = 2_147_483_647;
const timedOut = Symbol("timedOut");

const timeout = (ms: number): Promise<typeof timedOut> =>
	new Promise((resolve) => {
		setTimeout(() => resolve(timedOut), Math.max(0, ms));
	});

const stepClose = async (
	kind: string,
	step: ShutdownStep,
): Promise<boolean> => {
	try {
		await step.close();
		return true;
	} catch (error) {
		logger.error({ err: error }, `${kind} ${step.name} failed to close`);
		return false;
	}
};

const deadlineMsDefault = 25_000;
const drainDelayMsDefault = 5000;

/**
 * Owns SIGTERM, SIGINT, uncaughtException and unhandledRejection, and exits the process: 0 when
 * every step closed in time, 1 otherwise or after a crash. Throws a `TypeError` on a
 * `deadlineMs` that is not an integer over 5000 and at most 2147483647, or a `drainDelayMs` that is not a whole number
 * under `deadlineMs` minus 5000.
 */
export const shutdownHandleCreate = ({
	deadlineMs: deadlineMsGiven,
	drainDelayMs: drainDelayMsGiven,
	intakes,
	resources,
}: ShutdownOptions): ShutdownHandle => {
	const deadlineMs = deadlineMsGiven ?? deadlineMsDefault;
	const drainDelayMs = drainDelayMsGiven ?? drainDelayMsDefault;
	// At or under the reserve, or with the drain reaching the cutoff, the intakes would get no
	// time: every one would be cut at once.
	if (
		!Number.isInteger(deadlineMs) ||
		deadlineMs <= resourceReserveMs ||
		deadlineMs > timerMax
	) {
		throw new TypeError(
			`shutdownHandleCreate: deadlineMs must be an integer over ${resourceReserveMs}, ${timerMax} at most, found ${deadlineMs}`,
		);
	}
	if (!Number.isInteger(drainDelayMs) || drainDelayMs < 0) {
		throw new TypeError(
			`shutdownHandleCreate: drainDelayMs must be a whole number, found ${drainDelayMs}`,
		);
	}
	if (drainDelayMs >= deadlineMs - resourceReserveMs) {
		throw new TypeError(
			`shutdownHandleCreate: drainDelayMs must be under deadlineMs minus ${resourceReserveMs} (${deadlineMs - resourceReserveMs}), found ${drainDelayMs}`,
		);
	}
	let shuttingDown = false;
	// Set by any crash, also one during a shutdown a signal started.
	let crashed = false;

	// Resolves true when every step closed in time.
	const shutdownRun = async (drainMs: number): Promise<boolean> => {
		let clean = true;
		const cutoff = timeout(deadlineMs - resourceReserveMs);
		const deadline = timeout(deadlineMs);

		// Readiness already answers 503; keep serving while load balancers notice.
		await Promise.race([timeout(drainMs), cutoff]);

		const open = new Set(intakes);
		const intakesDone = Promise.all(
			intakes.map(async (intake) => {
				const closed = await stepClose("Intake", intake);
				open.delete(intake);
				return closed;
			}),
		);
		const intakeResult = await Promise.race([intakesDone, cutoff]);
		if (intakeResult === timedOut) {
			clean = false;
			for (const intake of open) {
				logger.warn(`Intake ${intake.name} still open at the cutoff`);
			}
		} else if (intakeResult.includes(false)) {
			clean = false;
		}

		for (const [index, resource] of resources.entries()) {
			const closed = await Promise.race([
				stepClose("Resource", resource),
				deadline,
			]);
			if (closed === timedOut) {
				clean = false;
				for (const left of resources.slice(index)) {
					logger.error(`Resource ${left.name} still open at the deadline`);
				}
				break;
			}
			if (!closed) {
				clean = false;
			}
		}

		return clean;
	};

	// Always exits, even if the shutdown itself throws.
	const shutdownExit = async (drainMs: number): Promise<void> => {
		const clean = await shutdownRun(drainMs).catch(() => false);
		const code = clean && !crashed ? 0 : 1;
		logger.info({ code }, "Shutdown finished");
		process.exit(code);
	};

	const start = (drainMs: number): boolean => {
		if (shuttingDown) {
			return false;
		}
		shuttingDown = true;
		void shutdownExit(drainMs);
		return true;
	};

	const onSignal = (signal: NodeJS.Signals) => {
		if (start(drainDelayMs)) {
			logger.info(`Shutdown started on ${signal}`);
		}
	};

	const onCrash = (error: unknown) => {
		logger.fatal({ err: error }, "Crashed, shutting down");
		crashed = true;
		start(0);
	};

	process.on("SIGTERM", onSignal);
	process.on("SIGINT", onSignal);
	process.on("uncaughtException", onCrash);
	process.on("unhandledRejection", onCrash);

	return { isShuttingDown: () => shuttingDown };
};
