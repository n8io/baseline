import type { StandardSchemaV1 } from "@standard-schema/spec";
import { z } from "zod";
import { featureFlagsDefine } from "./feature-flags-define.ts";

type Theme = { readonly mode: "dark" | "light" };

const themeSchema: StandardSchemaV1<unknown, Theme> = z.object({
	mode: z.enum(["dark", "light"]),
});

// Flags every contract run reads, one of each type a flag can have. The type is written out
// because isolatedDeclarations asks every export for one.
type TestDefs = {
	readonly checkoutRedesign: {
		readonly fallback: false;
		readonly key: "checkout-redesign";
	};
	readonly heroCopy: {
		readonly fallback: "plain";
		readonly key: "hero-copy";
		readonly values: readonly ["plain", "bold"];
	};
	readonly itemLimit: { readonly fallback: 10; readonly key: "item-limit" };
	readonly theme: {
		readonly fallback: Theme;
		readonly key: "theme";
		readonly schema: StandardSchemaV1<unknown, Theme>;
	};
};

export const featureFlagsTestDefs: TestDefs = featureFlagsDefine({
	checkoutRedesign: { fallback: false, key: "checkout-redesign" },
	heroCopy: { fallback: "plain", key: "hero-copy", values: ["plain", "bold"] },
	itemLimit: { fallback: 10, key: "item-limit" },
	theme: {
		fallback: { mode: "light" },
		key: "theme",
		schema: themeSchema,
	},
});

export const featureFlagsTestKinds: {
	readonly actor: "required";
	readonly customer: "optional";
} = { actor: "required", customer: "optional" };
