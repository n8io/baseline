import { defineConfig, mergeConfig } from "vitest/config";
import { vitestShared } from "../../vitest.shared.ts";

// Each CLI test starts a Node process per command, and a forced run (the nightly) runs every
// task at once: a test that sends three commands takes about 5 s there, the default limit.
export default mergeConfig(
	vitestShared,
	defineConfig({ test: { testTimeout: 30_000 } }),
);
