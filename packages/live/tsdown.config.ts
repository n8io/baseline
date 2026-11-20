import { defineConfig } from "tsdown";

const shared = {
	dts: true,
	fixedExtension: false,
	format: "esm",
} as const;

// The client entry runs in browsers, so it builds for no platform, like sdk.
export default defineConfig([
	{ ...shared, entry: ["src/index.ts", "src/testing.ts"], platform: "node" },
	{ ...shared, entry: ["src/client.ts"], platform: "neutral" },
]);
