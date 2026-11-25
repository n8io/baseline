import { describe, expect, it } from "vitest";
import {
	featureFlagsForActor,
	featureFlagsOpen,
} from "./feature-flags-open.ts";
import type { ShutdownSteps } from "./shutdown-step-add.ts";

const steps: ShutdownSteps = { intakes: [], resources: [] };
const actor = { id: "a1", kind: "user", scopes: [] } as const;

describe("featureFlagsOpen", () => {
	it("answers every flag with its fallback, with nothing to close, when there is no SDK key", async () => {
		const opened = featureFlagsOpen({ steps });
		expect(opened.steps).toEqual(steps);
		expect(
			await featureFlagsForActor({
				actor,
				featureFlags: opened.featureFlags,
			}).get("exampleFlag"),
		).toBe(false);
	});

	it("opens LaunchDarkly with an SDK key, answers its fallbacks while offline, and closes at shutdown", async () => {
		// Offline, so nothing leaves the process.
		const opened = featureFlagsOpen({
			sdkKey: "sdk-test",
			steps,
			vendor: { offline: true, sendEvents: false },
		});
		expect(opened.steps.resources.map((s) => s.name)).toEqual([
			"feature flags",
		]);
		await opened.featureFlags.ready;
		expect(
			await featureFlagsForActor({
				actor,
				featureFlags: opened.featureFlags,
			}).get("exampleFlag"),
		).toBe(false);
		await opened.steps.resources[0]?.close();
	});
});
