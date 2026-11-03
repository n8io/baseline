import type { Actor } from "@n8io/baseline-authn";
import { FooListInput, type FooUseCases } from "../index.ts";

// Three foos for local development; skips when any foo exists, so a Postgres database is seeded once.
export const fooSeed = async (u: FooUseCases, actor: Actor) => {
	const list = await u.fooList(actor, FooListInput.parse({ limit: 1 }));
	if (list.ok && list.value.items.length) return;
	for (const name of ["Alpha", "Beta", "Gamma"]) {
		await u.fooCreate(actor, { name });
	}
};
