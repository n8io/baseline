import {
	defineConfig,
	type TestProjectInlineConfiguration,
} from "vitest/config";

// Base settings every Vitest config in this repo extends with mergeConfig.
export const vitestShared = defineConfig({
	test: {
		expect: { requireAssertions: true },
	},
});

// Splits a package's tests in two projects. `<service>` runs the files named `*.<service>.test.ts`
// with the globalSetup that starts the container; `unit` runs the rest and needs no Docker.
export const vitestProjectsCreate = (
	service: string,
	serviceTest: NonNullable<TestProjectInlineConfiguration["test"]>,
): TestProjectInlineConfiguration[] => [
	{
		extends: true,
		test: {
			exclude: [`src/**/*.${service}.test.ts`],
			include: ["src/**/*.test.ts"],
			name: "unit",
		},
	},
	{
		extends: true,
		test: {
			...serviceTest,
			include: [`src/**/*.${service}.test.ts`],
			name: service,
		},
	},
];
