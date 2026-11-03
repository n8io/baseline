import type { Actor } from "@n8io/baseline-authn";
import { err, ok, type Result } from "@n8io/baseline-result";
import { trace } from "@opentelemetry/api";
import { FooForbiddenError, FooNotFoundError } from "../foo-errors.ts";
import type { FooDeleteInput } from "../models/foo.ts";
import type { FooPorts } from "../ports.ts";
import { fooDeletable } from "../rules/foo-deletable.ts";

export const fooDelete =
	({
		fooTransaction,
		fooCache,
		fooLiveUpdates,
	}: Pick<FooPorts, "fooTransaction" | "fooCache" | "fooLiveUpdates">) =>
	async (
		actor: Actor,
		input: FooDeleteInput,
	): Promise<Result<void, FooNotFoundError | FooForbiddenError>> => {
		trace.getActiveSpan()?.setAttributes({ "baseline.foo.id": input.fooId });
		const result = await fooTransaction<
			void,
			FooNotFoundError | FooForbiddenError
		>(async ({ fooRepository, fooEvents }) => {
			const foo = await fooRepository.findById(input.fooId);
			if (!foo) return err(new FooNotFoundError(input.fooId));
			if (!fooDeletable(foo, actor)) {
				return err(new FooForbiddenError(input.fooId));
			}
			await fooRepository.delete(foo.id);
			await fooEvents.publish("foo.deleted", { fooId: foo.id });
			return ok(undefined);
		});
		// After commit, outside the callback.
		if (result.ok) {
			await fooCache.delete(input.fooId);
			await fooLiveUpdates.send({ type: "foo.deleted", id: input.fooId });
		}
		return result;
	};
