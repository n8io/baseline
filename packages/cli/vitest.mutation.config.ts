import { defineConfig, mergeConfig } from "vitest/config";
import { vitestShared } from "../../vitest.shared.ts";

// Stryker runs the unit tests only. The "published types" case builds the package, and a mutated
// source cannot build (isolatedDeclarations needs an explicit type on Stryker's wrapped exports).
export default mergeConfig(
	vitestShared,
	defineConfig({ test: { testNamePattern: /^(?!the published types)/ } }),
);
