import type { ShutdownStep } from "@n8io/baseline-shutdown";
import { describe, expect, it } from "vitest";
import { serverDevCloseCreate } from "./server-dev-close.ts";

describe("serverDevCloseCreate", () => {
	it("closes the intakes, then the resources, and its health server last", async () => {
		const closed: string[] = [];
		const step = (name: string): ShutdownStep => ({
			close: async () => {
				closed.push(name);
			},
			name,
		});

		await serverDevCloseCreate({
			connections: {
				intakes: [step("http"), step("live")],
				resources: [step("database")],
			},
			health: { close: async () => void closed.push("health") },
		})();

		expect(closed).toEqual(["http", "live", "database", "health"]);
	});
});
