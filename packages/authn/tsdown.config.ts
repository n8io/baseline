import { defineConfig } from "tsdown";

export default defineConfig({
	dts: true,
	entry: ["src/index.ts", "src/client.ts"],
	fixedExtension: false,
	format: "esm",
	platform: "node",
});
