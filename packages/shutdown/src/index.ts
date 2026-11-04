import { logger } from "@n8io/baseline-logger";

// One thing to close on shutdown: an intake (HTTP server, live streams, the queue)
// or a resource (pools, clients, health, telemetry).
export type ShutdownStep = { name: string; close: () => Promise<void> };

type ShutdownOptions = {
	// Counted from the signal, including the drain delay.
	deadlineMs?: number;
	// Roots pass 0 outside production.
	drainDelayMs?: number;
	// Closed together; each stops accepting, then waits for its active work.
	intakes: ShutdownStep[];
	// Closed one by one, in order, after every intake is done; telemetry last.
	resources: ShutdownStep[];
};

export type ShutdownHandle = { isShuttingDown(): boolean };

// The last 5 s before the deadline belong to the resources.
const RESOURCE_RESERVE_MS = 5000;
const TIMED_OUT = Symbol("timedOut");

const timeout = (ms: number): Promise<typeof TIMED_OUT> =>
	new Promise((resolve) => {
		setTimeout(() => resolve(TIMED_OUT), Math.max(0, ms));
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

// Owns SIGTERM, SIGINT, uncaughtException and unhandledRejection, and exits the
// process: 0 when every step closed in time, 1 otherwise or after a crash.
export const shutdownHandle = ({
	deadlineMs = 25_000,
	drainDelayMs = 5000,
	intakes,
	resources,
}: ShutdownOptions): ShutdownHandle => {
	let shuttingDown = false;
	// Set by any crash, also one during a shutdown a signal started.
	let crashed = false;

	// Resolves true when every step closed in time.
	const shutdownRun = async (drainMs: number): Promise<boolean> => {
		let clean = true;
		const cutoff = timeout(deadlineMs - RESOURCE_RESERVE_MS);
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
		if (intakeResult === TIMED_OUT) {
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
			if (closed === TIMED_OUT) {
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
