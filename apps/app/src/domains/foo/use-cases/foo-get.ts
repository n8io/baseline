import type { Actor } from "@n8io/baseline-authn";
import { err, ok, type Result } from "@n8io/baseline-result";
import { telemetrySpanAttributesSet } from "@n8io/baseline-telemetry/span";
import { FooNotFoundError } from "../foo-errors.ts";
import type { Foo, FooGetInput } from "../models/foo.ts";
import type { FooPorts } from "../ports.ts";

// `actor` is unused but required, so every caller states who is asking.
export const fooGet =
	(ports: FooPorts) =>
	async (
		_actor: Actor,
		input: FooGetInput,
	): Promise<Result<Foo, FooNotFoundError>> => {
		telemetrySpanAttributesSet({ "baseline.foo.id": input.fooId });
		// piece-start: cache
		const cached = await ports.fooCache.get(input.fooId);
		if (cached) return ok(cached);
		// piece-end: cache
		const foo = await ports.fooReadRepository.findById(input.fooId);
		if (!foo) return err(new FooNotFoundError(input.fooId));
		// piece-start: cache
		await ports.fooCache.set(foo);
		// piece-end: cache
		return ok(foo);
	};
