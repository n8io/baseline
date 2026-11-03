import { expect, test } from "vitest";
import { vitestShared } from "../vitest.shared.ts";

test("vitestShared requires every test to assert", () => {
	expect(vitestShared.test?.expect?.requireAssertions).toBe(true);
});
