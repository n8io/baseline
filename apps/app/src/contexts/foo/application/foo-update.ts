import type { Actor } from "@n8io/baseline-authn";
import { err, type Result } from "@n8io/baseline-result";
import { telemetrySpanAttributesSet } from "@n8io/baseline-telemetry/span";
import {
	FooForbiddenError,
	type FooNameTakenError,
	FooNotFoundError,
} from "../domain/errors.ts";
import type { Foo, FooUpdateInput } from "../domain/foo.ts";
import { fooUpdateCan } from "../domain/foo-update-can.ts";
import type { FooPorts } from "./ports.ts";

export const fooUpdate =
	(ports: FooPorts) =>
	async (
		actor: Actor,
		input: FooUpdateInput,
	): Promise<
		Result<Foo, FooNotFoundError | FooNameTakenError | FooForbiddenError>
	> => {
		telemetrySpanAttributesSet({ "baseline.foo.id": input.fooId });
		const result = await ports.fooTransaction<
			Foo,
			FooNotFoundError | FooNameTakenError | FooForbiddenError
		>(async ({ fooRepository }) => {
			// Locks the row: a concurrent write waits until this commits instead of being undone.
			const foo = await fooRepository.findByIdForUpdate(input.fooId);
			if (!foo) return err(new FooNotFoundError(input.fooId));
			if (!fooUpdateCan(foo, actor)) {
				return err(new FooForbiddenError(input.fooId));
			}
			return fooRepository.update({
				...foo,
				name: input.name,
				updatedAt: ports.fooClock.now(),
			});
		});
		// After commit, outside the callback.
		if (result.ok) {
			// piece-start: cache
			await ports.fooCache.delete(input.fooId);
			// piece-end: cache
			// piece-start: live
			await ports.fooLiveUpdates.send({ type: "foo.updated", id: input.fooId });
			// piece-end: live
		}
		return result;
	};
