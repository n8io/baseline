// Every feature flag the Project reads, declared once. A flag's name is how code reads it; `key` is
// its key in the flag service, the same in every environment. `pnpm piece-remove feature-flags`
// deletes this file.
import { featureFlagsDefine } from "@n8io/baseline-feature-flags";

export const flagDefs = featureFlagsDefine({
	exampleFlag: { fallback: false, key: "example-flag" },
});

// The kinds a context holds. Each needs a context kind of the same name in the flag service.
export const flagKinds: { readonly actor: "required" } = {
	actor: "required",
};
