import { describe, expect, it } from "vitest";
import { loader } from "#ui/routes/home.tsx";

// domain-create copies this as test/unit/home.test.ts with a project's first domain only, like home.tsx.
describe("home loader", () => {
	it("redirects to /foos", () => {
		const response = loader();
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/foos");
	});
});
