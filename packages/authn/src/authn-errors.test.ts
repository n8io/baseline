import { describe, expect, it } from "vitest";
import { AuthnInvalidError, AuthnRequiredError } from "./authn-errors.ts";

describe("authn errors", () => {
	it("AuthnRequiredError answers 401 AuthnRequired", () => {
		const error = new AuthnRequiredError("no actor");

		expect(error).toBeInstanceOf(Error);
		expect(error.type).toBe("AuthnRequired");
		expect(error.httpStatus).toBe(401);
		expect(error.name).toBe("AuthnRequiredError");
		expect(error.message).toBe("no actor");
	});

	it("AuthnInvalidError answers 401 AuthnInvalid", () => {
		const error = new AuthnInvalidError("bad token");

		expect(error).toBeInstanceOf(Error);
		expect(error.type).toBe("AuthnInvalid");
		expect(error.httpStatus).toBe(401);
		expect(error.name).toBe("AuthnInvalidError");
		expect(error.message).toBe("bad token");
	});
});
