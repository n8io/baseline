import { defineConfig } from "tsdown";

// Every entry builds for no platform: the core, the browser adapter and the React layer also run
// in browsers, like sdk, and the adapters import only npm packages.
export default defineConfig({
	dts: true,
	entry: {
		index: "src/index.ts",
		launchdarkly: "src/launchdarkly/index.ts",
		"launchdarkly/client": "src/launchdarkly-client/index.ts",
		react: "src/react/index.ts",
		testing: "src/testing.ts",
	},
	fixedExtension: false,
	format: "esm",
	platform: "neutral",
});
