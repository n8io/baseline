import type { Actor } from "@n8io/baseline-authn";
import { ok, type Result } from "@n8io/baseline-result";
import type { FooPorts } from "../ports.ts";
import { fooStaleBefore } from "../rules/foo-stale-is.ts";

// The schedule's use case: archives every foo that is stale as of now and returns how many.
// `actor` is unused but required, so every caller states who is asking.
export const fooStaleArchive =
	({ fooTransaction }: Pick<FooPorts, "fooTransaction">) =>
	(_actor: Actor): Promise<Result<number, never>> =>
		fooTransaction(async ({ fooRepository }) => {
			const now = new Date();
			return ok(await fooRepository.archiveStale(fooStaleBefore(now), now));
		});
