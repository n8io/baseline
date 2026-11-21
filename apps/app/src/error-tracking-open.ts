// Error reports for an entry point: with a DSN, every error the logger logs at error or fatal
// goes to Sentry; without one, errors are only logged. `pnpm piece-remove error-tracking` deletes
// this file.
import { errorTrackingSentryCreate } from "@n8io/baseline-error-tracking";
import { loggerErrorListen } from "@n8io/baseline-logger";
import { type ShutdownSteps, shutdownStepAdd } from "./shutdown-step-add.ts";

// With Sentry, the steps it returns add one that stops reporting and waits for the reports in
// flight at shutdown.
export const errorTrackingOpen = ({
	dsn,
	environment,
	steps,
}: {
	dsn?: string | null;
	environment: string;
	steps: ShutdownSteps;
}): ShutdownSteps => {
	if (!dsn) return steps;
	const errorTracking = errorTrackingSentryCreate({ dsn, environment });
	const stop = loggerErrorListen((error) => errorTracking.report(error));
	return shutdownStepAdd({
		at: "last",
		group: "resources",
		step: {
			close: async () => {
				stop();
				await errorTracking.close();
			},
			name: "error tracking",
		},
		steps,
	});
};
