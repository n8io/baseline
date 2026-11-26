/** Tells the Project's logger an outage ended. A logger that throws must not fail a read. */
export const featureFlagsRecoveredReport = (
	onRecovered: (() => unknown) | null | undefined,
): void => {
	try {
		Promise.resolve(onRecovered?.()).catch(() => undefined);
	} catch {
		// A logger that throws must not fail a read.
	}
};
