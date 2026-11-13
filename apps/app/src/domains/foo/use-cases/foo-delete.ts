import type { Actor } from "@n8io/baseline-authn";
import { err, ok, type Result } from "@n8io/baseline-result";
import { telemetrySpanAttributesSet } from "@n8io/baseline-telemetry/span";
import { FooForbiddenError, FooNotFoundError } from "../foo-errors.ts";
import type { FooDeleteInput } from "../models/foo.ts";
import type { FooPorts } from "../ports.ts";
import { fooDeleteCan } from "../rules/foo-delete-can.ts";

export const fooDelete =
	(ports: FooPorts) =>
	async (
		actor: Actor,
		input: FooDeleteInput,
	): Promise<Result<void, FooNotFoundError | FooForbiddenError>> => {
		telemetrySpanAttributesSet({ "baseline.foo.id": input.fooId });
		const result = await ports.fooTransaction<
			void,
			FooNotFoundError | FooForbiddenError
		>(async (transaction) => {
			const foo = await transaction.fooRepository.findById(input.fooId);
			if (!foo) return err(new FooNotFoundError(input.fooId));
			if (!fooDeleteCan(foo, actor)) {
				return err(new FooForbiddenError(input.fooId));
			}
			await transaction.fooRepository.delete(foo.id);
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
