// The one example of reading a flag in the UI: it puts the flag's value on <html> as
// `data-example-flag`, for a stylesheet or a test to read. Delete it, or read a flag where it
// matters. `pnpm piece-remove feature-flags` deletes this file.
import { useEffect } from "react";
import { useFeatureFlag } from "./feature-flags.ts";

export const FeatureFlagExample = () => {
	const exampleFlag = useFeatureFlag("exampleFlag");
	useEffect(() => {
		document.documentElement.dataset["exampleFlag"] = String(exampleFlag);
	}, [exampleFlag]);
	return null;
};
