import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * One flag as the Project declares it. `key` is the flag's key in the flag service, written only
 * here. `fallback` is what a read returns when the service cannot answer. `values` limits a string
 * flag to a union, and `schema` (any Standard Schema: Zod, Valibot, ArkType) types a JSON flag by
 * its output. A flag has `values` or `schema`, never both.
 */
export type FeatureFlagDefinition =
	| {
			readonly key: string;
			readonly fallback: boolean | number | string;
			readonly values?: undefined;
			readonly schema?: undefined;
	  }
	| {
			readonly key: string;
			readonly fallback: string;
			readonly values: readonly string[];
			readonly schema?: undefined;
	  }
	| {
			readonly key: string;
			readonly fallback: unknown;
			readonly schema: StandardSchemaV1;
			readonly values?: undefined;
	  };

/** Every flag a Project declares, by the camelCase name that code reads it with. */
export type FeatureFlagDefinitions = Readonly<
	Record<string, FeatureFlagDefinition>
>;

type Widen<T> = T extends boolean
	? boolean
	: T extends number
		? number
		: T extends string
			? string
			: T;

/**
 * The type a flag reads as: its schema's output, its `values` union, or its fallback's type
 * widened (`false` is `boolean`, `10` is `number`). A caller that needs the type by name writes
 * `FlagValue<typeof flagDefs.heroCopy>`.
 */
export type FlagValue<D extends FeatureFlagDefinition> = D extends {
	readonly schema: infer S extends StandardSchemaV1;
}
	? StandardSchemaV1.InferOutput<S>
	: D extends { readonly values: readonly (infer V)[] }
		? V
		: Widen<D["fallback"]>;

type FallbackCheck<D> = D extends {
	readonly schema: infer S extends StandardSchemaV1;
}
	? { readonly fallback: StandardSchemaV1.InferOutput<S> }
	: D extends { readonly values: readonly (infer V extends string)[] }
		? { readonly fallback: V }
		: unknown;

/** Makes a fallback outside `values`, or of the wrong type for `schema`, a compile error. */
export type FeatureFlagChecks<D> = {
	readonly [N in keyof D]: FallbackCheck<D[N]>;
};
