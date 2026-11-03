import type { Actor } from "@n8io/baseline-authn";
import { err, type Result } from "@n8io/baseline-result";
import { trace } from "@opentelemetry/api";
import {
	FooForbiddenError,
	type FooNameTakenError,
	FooNotFoundError,
} from "../foo-errors.ts";
import type { Foo, FooUpdateInput } from "../models/foo.ts";
import type { FooPorts } from "../ports.ts";
import { fooUpdatable } from "../rules/foo-updatable.ts";

export const fooUpdate =
	({
		fooTransaction,
		fooCache,
		fooLiveUpdates,
	}: Pick<FooPorts, "fooTransaction" | "fooCache" | "fooLiveUpdates">) =>
	async (
		actor: Actor,
		input: FooUpdateInput,
	): Promise<
		Result<Foo, FooNotFoundError | FooNameTakenError | FooForbiddenError>
	> => {
		trace.getActiveSpan()?.setAttributes({ "baseline.foo.id": input.fooId });
		const result = await fooTransaction<
			Foo,
			FooNotFoundError | FooNameTakenError | FooForbiddenError
		>(async ({ fooRepository }) => {
			const foo = await fooRepository.findById(input.fooId);
			if (!foo) return err(new FooNotFoundError(input.fooId));
			if (!fooUpdatable(foo, actor)) {
				return err(new FooForbiddenError(input.fooId));
			}
			return fooRepository.update({
				...foo,
				name: input.name,
				updatedAt: new Date(),
			});
		});
		// After commit, outside the callback.
		if (result.ok) {
			await fooCache.delete(input.fooId);
			await fooLiveUpdates.send({ type: "foo.updated", id: input.fooId });
		}
		return result;
	};
