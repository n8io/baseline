// Error reports for an entry point: with a DSN, every error the logger logs at error or fatal
// goes to Sentry; without one, errors are only logged. `pnpm piece-remove error-tracking` deletes
// this file.
import { errorTrackingSentryCreate } from "@n8io/baseline-error-tracking";
import { loggerErrorListen } from "@n8io/baseline-logger";
import { resourceOpen, type ShutdownSteps } from "./shutdown-step-add.ts";

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
	return resourceOpen({
		at: "last",
		close: async () => {
			stop();
			await errorTracking.close();
		},
		group: "resources",
		name: "error tracking",
		resource: errorTracking,
		steps,
	});
};
