import { hkdfSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authnSecretKeyDerive } from "./authn-secret-key.ts";
import { authnTestSecret } from "./authn-test-helpers.ts";

describe("authnSecretKeyDerive", () => {
	it("derives a 32-byte HKDF-SHA256 key named by info, with an empty salt", () => {
		const key = authnSecretKeyDerive({
			info: "a use",
			secret: authnTestSecret,
		});
		const expected = new Uint8Array(
			hkdfSync(
				"sha256",
				Buffer.from(authnTestSecret, "base64url"),
				"",
				"a use",
				32,
			),
		);

		expect(key).toStrictEqual(expected);
	});

	it("derives another key for another use", () => {
		const first = authnSecretKeyDerive({
			info: "one",
			secret: authnTestSecret,
		});
		const second = authnSecretKeyDerive({
			info: "two",
			secret: authnTestSecret,
		});

		expect(first).not.toStrictEqual(second);
	});

	it.each([
		["too short", "AAAA"],
		["not base64url", `${authnTestSecret}=`],
		["with a stray character at the start", `!${authnTestSecret}`],
		[
			"with a stray character in the middle",
			`${authnTestSecret.slice(0, 20)}+${authnTestSecret.slice(21)}`,
		],
		["empty", ""],
	])("refuses a secret that is %s", (_, secret) => {
		expect(() => authnSecretKeyDerive({ info: "x", secret })).toThrow(
			"base64url",
		);
	});
});
