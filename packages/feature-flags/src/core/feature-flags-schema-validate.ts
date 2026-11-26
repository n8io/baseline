import type { StandardSchemaV1 } from "@standard-schema/spec";

type SchemaResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly async: boolean };

const featureFlagsIsThenable = (
	result: unknown,
): result is PromiseLike<unknown> =>
	typeof result === "object" &&
	result !== null &&
	typeof (result as { then?: unknown }).then === "function";

/** Runs a Standard Schema that must answer at once. A throw or a Promise is a failure. */
export const featureFlagsSchemaValidate = ({
	schema,
	value,
}: {
	schema: StandardSchemaV1;
	value: unknown;
}): SchemaResult => {
	try {
		const result = schema["~standard"].validate(value);
		if (featureFlagsIsThenable(result)) {
			return { async: true, ok: false };
		}
		return result.issues === undefined
			? { ok: true, value: result.value }
			: { async: false, ok: false };
	} catch {
		return { async: false, ok: false };
	}
};
