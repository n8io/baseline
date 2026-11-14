import { describe, expect, it } from "vitest";
import { checksPlanCreate, checksRun } from "./check.ts";

const ran = (failing: string[]) => {
	const commands: string[] = [];
	const result = checksRun({
		plan: checksPlanCreate({ uiIs: true }),
		stepRun: (step) => {
			commands.push(step.command);
			return failing.includes(step.command) ? 1 : 0;
		},
	});
	return { commands, ...result };
};

describe("check", () => {
	it("reports Biome and tsc failures from one run", () => {
		expect(ran(["biome", "tsc"])).toEqual({
			commands: ["varlock", "react-router", "biome", "tsc"],
			failed: ["biome", "tsc"],
		});
	});

	it("runs tsc after Biome fails", () => {
		expect(ran(["biome"]).failed).toEqual(["biome"]);
		expect(ran(["biome"]).commands).toContain("tsc");
	});

	it("stops at a failing generator", () => {
		expect(ran(["varlock"])).toEqual({
			commands: ["varlock"],
			failed: ["varlock"],
		});
	});

	it("skips route types when the Project has no UI", () => {
		expect(
			checksPlanCreate({ uiIs: false }).generators.map((step) => step.command),
		).toEqual(["varlock"]);
	});
});
