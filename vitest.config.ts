import { defineConfig, mergeConfig } from "vitest/config";
import { vitestShared } from "./vitest.shared.ts";

export default mergeConfig(
	vitestShared,
	defineConfig({
		test: {
			// test/render/ runs inside a rendered app, never here.
			exclude: ["test/render/**"],
			include: ["test/**/*.test.ts"],
		},
	}),
);
