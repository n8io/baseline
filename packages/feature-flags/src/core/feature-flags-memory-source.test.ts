import { describe, expect, it } from "vitest";
import {
	featureFlagsMemorySourceClientCreate,
	featureFlagsMemorySourceServerCreate,
	featureFlagsMemorySourceValuesByKey,
} from "./feature-flags-memory-source.ts";
import { featureFlagsTestDefs } from "./feature-flags-test-fixtures.ts";

const context = { actor: { id: "a1" } } as const;

describe("featureFlagsMemorySourceValuesByKey", () => {
	it("maps values given as an object from flag names onto keys, leaving out the flags with none", () => {
		const byKey = featureFlagsMemorySourceValuesByKey({
			flags: featureFlagsTestDefs,
			values: { heroCopy: "bold", itemLimit: 3 },
		});
		expect(byKey({})).toEqual({ "hero-copy": "bold", "item-limit": 3 });
	});

	it("maps values given as a function of the context", () => {
		const byKey = featureFlagsMemorySourceValuesByKey({
			flags: featureFlagsTestDefs,
			values: (resolved) => ({ itemLimit: resolved["actor"] ? 7 : 1 }),
		});
		expect(byKey(context)).toEqual({ "item-limit": 7 });
		expect(byKey({})).toEqual({ "item-limit": 1 });
	});
});

describe("featureFlagsMemorySourceServerCreate", () => {
	it("settles connected by default, whether ready is left out or null, and reads values", async () => {
		const values = () => ({ "item-limit": 3 });
		for (const source of [
			featureFlagsMemorySourceServerCreate({ values }),
			featureFlagsMemorySourceServerCreate({ ready: null, values }),
		]) {
			expect(await source.ready).toBe("connected");
			expect(
				await source.read({ context: {}, fallback: 10, key: "item-limit" }),
			).toEqual({ found: true, value: 3 });
			expect(
				await source.read({ context: {}, fallback: false, key: "gone" }),
			).toEqual({ found: false, reason: "notFound" });
		}
	});

	it("reads every flag as a vendor error when ready is not connected, and closes with a Promise", async () => {
		const source = featureFlagsMemorySourceServerCreate({
			ready: "timeout",
			values: () => ({ "item-limit": 3 }),
		});
		expect(await source.ready).toBe("timeout");
		expect(
			await source.read({ context: {}, fallback: 10, key: "item-limit" }),
		).toEqual({ found: false, reason: "vendorError" });
		expect(source.close()).toBeInstanceOf(Promise);
	});
});

describe("featureFlagsMemorySourceClientCreate", () => {
	const open = (ready?: "failed" | null) => {
		const source = featureFlagsMemorySourceClientCreate({
			context,
			...(ready === undefined ? {} : { ready }),
			values: (resolved) => ({ "item-limit": resolved["actor"] ? 3 : 4 }),
		});
		const heard: string[] = [];
		return { heard, source };
	};

	it("settles connected by default and reads from the current values and context", async () => {
		const { source } = open();
		expect(await source.ready).toBe("connected");
		expect(source.read({ fallback: 10, key: "item-limit" })).toEqual({
			found: true,
			value: 3,
		});
		await source.contextSet({});
		expect(source.read({ fallback: 10, key: "item-limit" })).toEqual({
			found: true,
			value: 4,
		});
	});

	it("settles as the status it was given, and reads a vendor error unless connected", async () => {
		const { source } = open("failed");
		expect(await source.ready).toBe("failed");
		expect(source.read({ fallback: 10, key: "item-limit" })).toEqual({
			found: false,
			reason: "vendorError",
		});
	});

	it("notifies subscribers of a context change and of new values, until they unsubscribe", async () => {
		const { heard, source } = open();
		const unsubscribe = source.subscribe(() => heard.push("changed"));
		await source.contextSet({});
		source.valuesSet(() => ({ "item-limit": 5 }));
		expect(heard).toEqual(["changed", "changed"]);
		expect(source.read({ fallback: 10, key: "item-limit" })).toEqual({
			found: true,
			value: 5,
		});
		unsubscribe();
		source.valuesSet(() => ({ "item-limit": 6 }));
		expect(heard).toEqual(["changed", "changed"]);
	});

	it("drops every subscriber when it closes, and closes with a Promise", async () => {
		const { heard, source } = open();
		source.subscribe(() => heard.push("changed"));
		const closing = source.close();
		expect(closing).toBeInstanceOf(Promise);
		await closing;
		source.valuesSet(() => ({ "item-limit": 5 }));
		expect(heard).toEqual([]);
	});
});
