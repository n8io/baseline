import type { Actor } from "@n8io/baseline-authn";
import { err, ok, type Result } from "@n8io/baseline-result";
import { telemetrySpanAttributesSet } from "@n8io/baseline-telemetry/span";
import { FooForbiddenError, FooNotFoundError } from "../domain/errors.ts";
import type { FooDeleteInput } from "../domain/foo.ts";
import { fooDeleteCan } from "../domain/foo-delete-can.ts";
import type { FooPorts } from "./ports.ts";

export const fooDelete =
	(ports: FooPorts) =>
	async (
		actor: Actor,
		input: FooDeleteInput,
	): Promise<Result<void, FooNotFoundError | FooForbiddenError>> => {
		telemetrySpanAttributesSet({ "baseline.foo.id": input.fooId });
		// invariant: a Bar never outlives its Foo, so its Bars go in the same transaction.
		const result = await ports.fooTransaction<
			void,
			FooNotFoundError | FooForbiddenError
		>(async (transaction) => {
			// Locks the row, so a concurrent delete waits and then finds nothing.
			const foo = await transaction.fooRepository.findByIdForUpdate(
				input.fooId,
			);
			if (!foo) return err(new FooNotFoundError(input.fooId));
			if (!fooDeleteCan(foo, actor)) {
				return err(new FooForbiddenError(input.fooId));
			}
			await transaction.barRepository.deleteByFooId(foo.id);
			const deleted = await transaction.fooRepository.delete(foo.id);
			if (!deleted.ok) return deleted;
			// piece-start: queue
			await transaction.fooEvents.publish({
				data: { fooId: foo.id },
				key: foo.id,
				name: "foo.deleted",
			});
			// piece-end: queue
			return ok(undefined);
		});
		// After commit, outside the callback.
		if (result.ok) {
			// piece-start: cache
			await ports.fooCache.delete(input.fooId);
			// piece-end: cache
			// piece-start: live
			await ports.fooLiveUpdates.send({ type: "foo.deleted", id: input.fooId });
			// piece-end: live
		}
		return result;
	};
