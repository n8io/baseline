// The Provider and hook for the flags in src/flags.ts, made once. Read a flag with
// `useFeatureFlag("exampleFlag")`: the value has the type the declaration gives it. Without a
// Provider, or before LaunchDarkly answers, it is the declared fallback.
// `pnpm piece-remove feature-flags` deletes this file.
import { featureFlagsReactCreate } from "@n8io/baseline-feature-flags/react";
import { flagDefs } from "../flags.ts";

export const { FeatureFlagsProvider, useFeatureFlag } =
	featureFlagsReactCreate(flagDefs);
