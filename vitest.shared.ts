import { defineConfig } from "vitest/config";

// Base settings every Vitest config in this repo extends with mergeConfig.
export const vitestShared = defineConfig({
	test: {
		expect: { requireAssertions: true },
	},
});
