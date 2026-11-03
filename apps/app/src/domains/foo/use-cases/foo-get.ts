import type { Actor } from "@n8io/baseline-authn";
import { err, ok, type Result } from "@n8io/baseline-result";
import { trace } from "@opentelemetry/api";
import { FooNotFoundError } from "../foo-errors.ts";
import type { Foo, FooGetInput } from "../models/foo.ts";
import type { FooPorts } from "../ports.ts";

// `actor` is unused but required, so every caller states who is asking.
export const fooGet =
	({
		fooReadRepository,
		fooCache,
	}: Pick<FooPorts, "fooReadRepository" | "fooCache">) =>
	async (
		_actor: Actor,
		input: FooGetInput,
	): Promise<Result<Foo, FooNotFoundError>> => {
		trace.getActiveSpan()?.setAttributes({ "baseline.foo.id": input.fooId });
		const cached = await fooCache.get(input.fooId);
		if (cached) return ok(cached);
		const foo = await fooReadRepository.findById(input.fooId);
		if (!foo) return err(new FooNotFoundError(input.fooId));
		await fooCache.set(foo);
		return ok(foo);
	};
