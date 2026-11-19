import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err, ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { fooPortsMemoryCreate } from "../adapters/outbound/foo-ports.memory.ts";
import { FooNotFoundError } from "../domain/errors.ts";
import { barCreate } from "./bar-create.ts";
import { barList } from "./bar-list.ts";
import { fooCreate } from "./foo-create.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };

describe("barList", () => {
	it("lists a foo's bars oldest first, and only that foo's", async () => {
		const { clock, ports } = fooPortsMemoryCreate();
		const [alpha, beta] = await Promise.all(
			["alpha", "beta"].map(async (name) => {
				const created = await fooCreate(ports)(owner, { name });
				if (!created.ok) throw created.error;
				return created.value;
			}),
		);
		if (!alpha || !beta) throw new Error("setup");
		for (const text of ["one", "two"]) {
			await barCreate(ports)(owner, { fooId: alpha.id, text });
			clock.advance(1000);
		}
		await barCreate(ports)(owner, { fooId: beta.id, text: "other" });

		const result = await barList(ports)(owner, { fooId: alpha.id });

		expect(result.ok && result.value.map((bar) => bar.text)).toEqual([
			"one",
			"two",
		]);
	});

	it("answers an empty list for a foo with no bars", async () => {
		const { ports } = fooPortsMemoryCreate();
		const created = await fooCreate(ports)(owner, { name: "alpha" });
		if (!created.ok) throw created.error;

		expect(await barList(ports)(owner, { fooId: created.value.id })).toEqual(
			ok([]),
		);
	});

	it("returns FooNotFoundError for a foo that does not exist", async () => {
		const { ports } = fooPortsMemoryCreate();

		expect(await barList(ports)(owner, { fooId: idCreate("foo") })).toEqual(
			err(expect.any(FooNotFoundError)),
		);
	});
});
