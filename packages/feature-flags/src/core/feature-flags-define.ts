import type {
	FeatureFlagChecks,
	FeatureFlagDefinition,
	FeatureFlagDefinitions,
} from "./feature-flags-define-types.ts";
import { featureFlagsSchemaValidate } from "./feature-flags-schema-validate.ts";

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
	if (typeof definition !== "object" || definition === null) {
		return "must be an object with a key and a fallback";
	}
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
 * schema, and a schema that validates asynchronously. The fallback is checked as the schema's
 * input and read as its output, so a schema that transforms needs a fallback both accept. Keys are the same in every environment.
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
