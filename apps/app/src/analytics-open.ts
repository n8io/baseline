// Analytics for a composition root: Mixpanel with a token, else the debug log.
// `pnpm piece-remove analytics` deletes this file.
import {
	type Analytics,
	analyticsLoggerCreate,
	analyticsMixpanelCreate,
} from "@n8io/baseline-analytics";
import type { ShutdownStep } from "@n8io/baseline-shutdown";

// With Mixpanel, `steps` waits for the sends in flight at shutdown.
export const analyticsOpen = ({
	steps,
	token,
}: {
	steps: ShutdownStep[];
	token: string | undefined;
}): Analytics => {
	if (!token) return analyticsLoggerCreate();
	const analytics = analyticsMixpanelCreate({ token });
	steps.push({ close: () => analytics.close(), name: "analytics" });
	return analytics;
};
