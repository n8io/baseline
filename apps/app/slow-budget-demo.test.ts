import { it, expect } from "vitest";

it("is deliberately slow", async () => {
	await new Promise((resolve) => setTimeout(resolve, 150_000));
	expect(true).toBe(true);
}, 170_000);
