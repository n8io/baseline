import type { Actor } from "@n8io/baseline-authn";
import { ok, type Result } from "@n8io/baseline-result";
import type { FooList, FooListInput } from "../models/foo.ts";
import type { FooPorts } from "../ports.ts";

// `actor` is unused but required, so every caller states who is asking.
export const fooList =
	({ fooReadRepository }: Pick<FooPorts, "fooReadRepository">) =>
	async (_actor: Actor, input: FooListInput): Promise<Result<FooList, never>> =>
		ok(await fooReadRepository.list(input));
