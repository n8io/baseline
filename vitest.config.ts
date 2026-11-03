import { defineConfig, mergeConfig } from "vitest/config";
import { vitestShared } from "./vitest.shared.ts";

export default mergeConfig(
	vitestShared,
	defineConfig({ test: { include: ["test/**/*.test.ts"] } }),
);
