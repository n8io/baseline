import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { featureFlagsDefine } from "./feature-flags-define.ts";
import { featureFlagsMemoryCreate } from "./feature-flags-memory.ts";
import { featureFlagsMemoryClientCreate } from "./feature-flags-memory-client.ts";

const flags = featureFlagsDefine({
	copy: { fallback: "plain", key: "copy", values: ["plain", "bold"] },
	enabled: { fallback: false, key: "enabled" },
	limit: { fallback: 10, key: "limit" },
	theme: {
		fallback: { mode: "light" as const },
		key: "theme",
		schema: z.object({ mode: z.enum(["dark", "light"]) }),
	},
});

const kinds = { actor: "required", customer: "optional" } as const;

// Vitest requires an assertion in every test, and expectTypeOf makes none at run time, so each
// test also checks one value. The types are checked by `tsc --noEmit` (the Package's `check`).
describe("feature flag client types", () => {
	it("types each read from the declaration, on the server and in the browser", async () => {
		const featureFlags = featureFlagsMemoryCreate({ flags, kinds });
		const handle = featureFlags.context({ actor: { id: "a" } });
		expectTypeOf(handle.get("enabled")).toEqualTypeOf<Promise<boolean>>();
		expectTypeOf(handle.get("copy")).toEqualTypeOf<Promise<"bold" | "plain">>();
		const client = featureFlagsMemoryClientCreate({
			context: { actor: { id: "a" } },
			flags,
			kinds,
		});
		expectTypeOf(client.flags.get("limit")).toEqualTypeOf<number>();
		expectTypeOf(client.flags.get("theme").mode).toEqualTypeOf<
			"dark" | "light"
		>();
		expect(await handle.get("limit")).toBe(10);
		await client.close();
		await featureFlags.close();
	});

	it("does not compile a typo in a flag name or a wrong value type", async () => {
		const featureFlags = featureFlagsMemoryCreate({
			flags,
			kinds,
			values: {
				// @ts-expect-error a number for a boolean flag
				enabled: 1,
				// @ts-expect-error a value outside the union
				copy: "loud",
			},
		});
		const handle = featureFlags.context({ actor: { id: "a" } });
		// @ts-expect-error no flag has this name
		const typo = handle.get("enabeld");
		expect(typo).toBeInstanceOf(Promise);
		await typo;
		await featureFlags.close();
	});

	it("does not compile a context that leaves out a required kind", () => {
		const featureFlags = featureFlagsMemoryCreate({ flags, kinds });
		// @ts-expect-error actor is required
		featureFlags.context({});
		// @ts-expect-error an unknown kind
		featureFlags.context({ actor: { id: "a" }, worker: { id: "w" } });
		featureFlags.context({ actor: { id: "a" }, customer: null });
		expect(featureFlags.context({ actor: { id: "a" } })).toBeDefined();
	});
});
