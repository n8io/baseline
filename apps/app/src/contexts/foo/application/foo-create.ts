import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import type { Result } from "@n8io/baseline-result";
import type { FooNameTakenError } from "../domain/errors.ts";
import { type Foo, type FooCreateInput, fooNew } from "../domain/foo.ts";
import type { FooPorts } from "./ports.ts";

export const fooCreate =
	(ports: FooPorts) =>
	async (
		actor: Actor,
		input: FooCreateInput,
	): Promise<Result<Foo, FooNameTakenError>> => {
		const result = await ports.fooTransaction(async (transaction) => {
			const inserted = await transaction.fooRepository.insert(
				fooNew({
					actor,
					id: idCreate("foo"),
					input,
					now: ports.fooClock.now(),
				}),
			);
			// piece-start: queue
			if (inserted.ok) {
				await transaction.fooEvents.publish({
					data: { fooId: inserted.value.id },
					key: inserted.value.id,
					name: "foo.created",
				});
			}
			// piece-end: queue
			return inserted;
		});
		// piece-start: analytics
		if (result.ok) {
			ports.fooAnalytics.track({
				actorId: actor.id,
				fooId: result.value.id,
				name: "foo.created",
			});
		}
		// piece-end: analytics
		return result;
	};
