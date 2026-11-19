import { describe, expect, it } from "vitest";
import { loader } from "#ui/routes/home.tsx";

// aggregate-create copies this with a project's first Aggregate with pages only, like home.tsx.
describe("home loader", () => {
	it("redirects to /foos", () => {
		const response = loader();
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/foos");
	});
});
