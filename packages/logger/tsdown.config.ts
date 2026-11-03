import { defineConfig } from "tsdown";

export default defineConfig({
	dts: true,
	entry: ["src/index.ts", "src/logger-err-serialize.ts"],
	fixedExtension: false,
	format: "esm",
	platform: "node",
});
