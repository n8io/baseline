import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err, type Result } from "@n8io/baseline-result";
import { telemetrySpanAttributesSet } from "@n8io/baseline-telemetry/span";
import { type Bar, type BarCreateInput, barNew } from "../domain/bar.ts";
import { type FooForbiddenError, FooNotFoundError } from "../domain/errors.ts";
import type { FooPorts } from "./ports.ts";

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
				const bar = barNew({
					actor,
					foo,
					id: idCreate("bar"),
					input,
					now: ports.fooClock.now(),
				});
				if (bar.ok) await transaction.barRepository.insert(bar.value);
				return bar;
			},
		);
	};
