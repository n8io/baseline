import type { StandardSchemaV1 } from "@standard-schema/spec";
import { featureFlagsSchemaValidate } from "./feature-flags-resolve.ts";

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
type FeatureFlagChecks<D> = { readonly [N in keyof D]: FallbackCheck<D[N]> };

// Names an object would answer for without being asked: a flag called one of these reads the
// wrong thing, or makes `await` treat the flag set as a thenable.
const namesReserved: ReadonlySet<string> = new Set([
	"__proto__",
	"constructor",
	"hasOwnProperty",
	"isPrototypeOf",
	"propertyIsEnumerable",
	"prototype",
	"then",
	"toLocaleString",
	"toString",
	"valueOf",
]);

const fallbackProblem = (definition: FeatureFlagDefinition): string | null => {
	const { fallback, schema, values } = definition;
	if (schema !== undefined) {
		const result = featureFlagsSchemaValidate({ schema, value: fallback });
		return result.ok
			? null
			: result.async
				? "schema must validate synchronously, but it returned a Promise"
				: "fallback must pass its own schema";
	}
	if (values !== undefined) {
		return values.includes(fallback)
			? null
			: `fallback ${JSON.stringify(fallback)} must be one of values`;
	}
	return ["boolean", "number", "string"].includes(typeof fallback)
		? null
		: "fallback must be a boolean, number or string, or the flag needs a schema";
};

const problemOf = ({
	definition,
	keys,
	name,
}: {
	definition: FeatureFlagDefinition;
	keys: ReadonlySet<string>;
	name: string;
}): string | null => {
	if (namesReserved.has(name)) {
		return `${name} is a reserved name; pick another`;
	}
	if (typeof definition.key !== "string" || definition.key.trim() === "") {
		return "key must be a non-empty string";
	}
	if (keys.has(definition.key)) {
		return `key ${JSON.stringify(definition.key)} is used by another flag`;
	}
	if (definition.values !== undefined && definition.schema !== undefined) {
		return "values and schema cannot be used together";
	}
	return fallbackProblem(definition);
};

/**
 * Declares a Project's flags once, usually in `src/flags.ts`. Returns them typed from what is
 * written: `values` gives a union, `schema` its output, a plain fallback its widened type. A typo,
 * a fallback outside `values` or a fallback the schema rejects does not compile. Throws a
 * `TypeError` when the module loads for an empty or duplicate key, a reserved name (`__proto__`,
 * `constructor`, `then`, `toString` and the like), a fallback outside `values` or failing its
 * schema, and a schema that validates asynchronously. Keys are the same in every environment.
 *
 * @example
 * export const flagDefs = featureFlagsDefine({
 *   checkoutRedesign: { key: "checkout-redesign", fallback: false },
 *   heroCopy: { key: "hero-copy", fallback: "plain", values: ["plain", "bold"] },
 * });
 */
export const featureFlagsDefine = <const D extends FeatureFlagDefinitions>(
	definitions: D & FeatureFlagChecks<D>,
): D => {
	const entries: readonly [string, FeatureFlagDefinition][] =
		Object.entries(definitions);
	const problems = entries.flatMap(([name, definition], index) => {
		const keys = new Set(
			entries.slice(0, index).map(([, earlier]) => earlier.key),
		);
		const problem = problemOf({ definition, keys, name });
		return problem === null
			? []
			: [`featureFlagsDefine: flag ${name}: ${problem}`];
	});
	const [first] = problems;
	if (first !== undefined) {
		throw new TypeError(first);
	}
	// A copy, so a later edit of the caller's object cannot change a declared flag.
	return Object.freeze(
		Object.fromEntries(
			entries.map(([name, definition]) => [
				name,
				Object.freeze({
					...definition,
					...(definition.values && {
						values: Object.freeze([...definition.values]),
					}),
				}),
			]),
		),
	) as D;
};
