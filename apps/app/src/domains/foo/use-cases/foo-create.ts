import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import type { Result } from "@n8io/baseline-result";
import type { FooNameTakenError } from "../foo-errors.ts";
import type { Foo, FooCreateInput } from "../models/foo.ts";
import type { FooPorts } from "../ports.ts";

export const fooCreate =
	({ fooTransaction }: Pick<FooPorts, "fooTransaction">) =>
	(
		actor: Actor,
		input: FooCreateInput,
	): Promise<Result<Foo, FooNameTakenError>> =>
		fooTransaction(async (transaction) => {
			const now = new Date();
			const result = await transaction.fooRepository.insert({
				id: idCreate("foo"),
				name: input.name,
				createdBy: actor.id,
				createdAt: now,
				updatedAt: now,
				archivedAt: null,
			});
			// piece-start: queue
			if (result.ok) {
				await transaction.fooEvents.publish("foo.created", {
					fooId: result.value.id,
				});
			}
			// piece-end: queue
			return result;
		});
