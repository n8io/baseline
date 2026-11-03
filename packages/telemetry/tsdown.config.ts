import { defineConfig } from "tsdown";

export default defineConfig({
	dts: true,
	entry: ["src/index.ts", "src/register.ts"],
	fixedExtension: false,
	format: "esm",
	platform: "node",
});
