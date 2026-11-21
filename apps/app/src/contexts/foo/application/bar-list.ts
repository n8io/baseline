import type { Actor } from "@n8io/baseline-authn";
import { err, ok, type Result } from "@n8io/baseline-result";
import type { Bar, BarListInput } from "../domain/bar.ts";
import { FooNotFoundError } from "../domain/errors.ts";
import type { FooPorts } from "./ports.ts";

// `actor` is unused but required, so every caller states who is asking.
export const barList =
	({
		barReadRepository,
		fooReadRepository,
	}: Pick<FooPorts, "barReadRepository" | "fooReadRepository">) =>
	async (
		_actor: Actor,
		input: BarListInput,
	): Promise<Result<readonly Bar[], FooNotFoundError>> => {
		if (!(await fooReadRepository.findById(input.fooId))) {
			return err(new FooNotFoundError(input.fooId));
		}
		return ok(await barReadRepository.listByFooId(input.fooId));
	};
