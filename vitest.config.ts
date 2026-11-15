import { defineConfig, mergeConfig } from "vitest/config";
import { vitestShared } from "./vitest.shared.ts";

export default mergeConfig(
	vitestShared,
	defineConfig({
		test: {
			// The second-domain fixture's tests run inside a rendered app, never here.
			exclude: ["test/render/second-domain/**"],
			include: ["test/**/*.test.ts"],
		},
	}),
);
