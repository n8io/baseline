// Analytics for a composition root: Mixpanel with a token, else the debug log.
// `pnpm piece-remove analytics` deletes this file.
import {
	type Analytics,
	analyticsLoggerCreate,
	analyticsMixpanelCreate,
} from "@n8io/baseline-analytics";
import { type ShutdownSteps, shutdownStepAdd } from "./shutdown-step-add.ts";

// With Mixpanel, the steps it returns add one that waits for the sends in flight at shutdown.
export const analyticsOpen = ({
	steps,
	token,
}: {
	steps: ShutdownSteps;
	token?: string | null;
}): { analytics: Analytics; steps: ShutdownSteps } => {
	if (!token) return { analytics: analyticsLoggerCreate(), steps };
	const analytics = analyticsMixpanelCreate({ token });
	return {
		analytics,
		steps: shutdownStepAdd({
			at: "last",
			group: "resources",
			step: { close: () => analytics.close(), name: "analytics" },
			steps,
		}),
	};
};
