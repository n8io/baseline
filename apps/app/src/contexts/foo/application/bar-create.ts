import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err, ok, type Result } from "@n8io/baseline-result";
import { telemetrySpanAttributesSet } from "@n8io/baseline-telemetry/span";
import type { Bar, BarCreateInput } from "../domain/bar.ts";
import { FooForbiddenError, FooNotFoundError } from "../domain/errors.ts";
import { fooUpdateCan } from "../domain/foo-update-can.ts";
import type { FooPorts } from "./ports.ts";

// Whoever may change a Foo may add a Bar to it.
export const barCreate =
	(ports: FooPorts) =>
	async (
		actor: Actor,
		input: BarCreateInput,
	): Promise<Result<Bar, FooNotFoundError | FooForbiddenError>> => {
		telemetrySpanAttributesSet({ "baseline.foo.id": input.fooId });
		// invariant: a Bar names a Foo that exists. The Foo stays locked until the Bar is in, so a
		// concurrent fooDelete waits and then deletes the new Bar too.
		return ports.fooTransaction<Bar, FooNotFoundError | FooForbiddenError>(
			async (transaction) => {
				const foo = await transaction.fooRepository.findByIdForUpdate(
					input.fooId,
				);
				if (!foo) return err(new FooNotFoundError(input.fooId));
				if (!fooUpdateCan(foo, actor)) {
					return err(new FooForbiddenError(input.fooId));
				}
				const bar: Bar = {
					id: idCreate("bar"),
					fooId: foo.id,
					text: input.text,
					createdBy: actor.id,
					createdAt: ports.fooClock.now(),
				};
				await transaction.barRepository.insert(bar);
				return ok(bar);
			},
		);
	};
