import { describe, expect, it } from "vitest";
import { resourceOpen, type ShutdownSteps } from "./shutdown-step-add.ts";

const steps: ShutdownSteps = { intakes: [], resources: [] };

describe("resourceOpen", () => {
	it("adds a step that closes the resource, in the group and place named", async () => {
		const closed: string[] = [];
		const opened = resourceOpen({
			at: "first",
			group: "intakes",
			name: "thing",
			resource: { close: () => void closed.push("thing") },
			steps,
		});

		expect(opened.intakes.map(({ name }) => name)).toEqual(["thing"]);
		expect(opened.resources).toEqual([]);
		expect(steps.intakes).toEqual([]);

		await opened.intakes[0]?.close();

		expect(closed).toEqual(["thing"]);
	});

	it("runs the close it is given instead of the resource's own", async () => {
		const closed: string[] = [];
		const opened = resourceOpen({
			at: "last",
			close: (resource) => void closed.push(`custom ${resource.id}`),
			group: "resources",
			name: "thing",
			resource: { close: () => void closed.push("own"), id: 1 },
			steps,
		});

		await opened.resources[0]?.close();

		expect(closed).toEqual(["custom 1"]);
	});
});
