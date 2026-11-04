import { describe, expect, it } from "vitest";
import { postgresPortsGuard } from "../src/index.ts";

describe("postgresPortsGuard", () => {
	it("passes calls through while the transaction is open", async () => {
		const ports = postgresPortsGuard(
			{ label: "kept", sum: (a: number, b: number) => a + b },
			() => true,
		);

		await expect(ports.sum(1, 2)).resolves.toBe(3);
		expect(ports.label).toBe("kept");
	});

	it("throws once the transaction has ended", async () => {
		let open = true;
		const ports = postgresPortsGuard({ find: async () => "found" }, () => open);
		open = false;

		await expect(ports.find()).rejects.toThrow(
			"Transaction ports used after the transaction ended",
		);
	});
});
