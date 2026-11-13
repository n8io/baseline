// Error reports for a composition root: with a DSN, every error the logger logs at error or fatal
// goes to Sentry; without one, errors are only logged. `pnpm piece-remove error-tracking` deletes
// this file.
import { errorTrackingSentryCreate } from "@n8io/baseline-error-tracking";
import { loggerErrorListen } from "@n8io/baseline-logger";
import type { ShutdownStep } from "@n8io/baseline-shutdown";

// With Sentry, `steps` stops reporting and waits for the reports in flight at shutdown.
export const errorTrackingOpen = ({
	dsn,
	environment,
	steps,
}: {
	dsn: string | undefined;
	environment: string;
	steps: ShutdownStep[];
}): void => {
	if (!dsn) return;
	const errorTracking = errorTrackingSentryCreate({ dsn, environment });
	const stop = loggerErrorListen((error) => errorTracking.report(error));
	steps.push({
		close: async () => {
			stop();
			await errorTracking.close();
		},
		name: "error tracking",
	});
};
