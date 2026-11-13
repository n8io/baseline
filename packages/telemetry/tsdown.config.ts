import { defineConfig } from "tsdown";

export default defineConfig({
	dts: true,
	entry: ["src/index.ts", "src/register.ts", "src/telemetry-span.ts"],
	fixedExtension: false,
	format: "esm",
	platform: "node",
});
