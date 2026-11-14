import type { Actor } from "@n8io/baseline-authn";
import { type Foo, FooListInput, type FooUseCases } from "../index.ts";

const fooNames = ["Alpha", "Beta", "Gamma"];

// The foo with this name, archived or not: the unique index covers both.
const fooNamedFind = async ({
	actor,
	name,
	u,
}: {
	actor: Actor;
	name: string;
	u: FooUseCases;
}) => {
	for (const archived of [false, true]) {
		let cursor: string | undefined;
		do {
			const list = await u.fooList(
				actor,
				FooListInput.parse({ archived, cursor, limit: 100 }),
			);
			if (!list.ok) throw new Error("fooList never fails");
			const found = list.value.items.find((foo) => foo.name === name);
			if (found) return found;
			cursor = list.value.nextCursor ?? undefined;
		} while (cursor);
	}
	throw new Error(`foo ${name} is taken but cannot be listed`);
};

// Three foos for local development, ensured one by one by name: an empty, half-seeded or seeded
// database ends the same, and the result is always the three foos, ready for a later seed that
// needs their ids.
export const fooSeed = async (u: FooUseCases, actor: Actor): Promise<Foo[]> => {
	const foos: Foo[] = [];
	for (const name of fooNames) {
		const created = await u.fooCreate(actor, { name });
		foos.push(
			created.ok ? created.value : await fooNamedFind({ actor, name, u }),
		);
	}
	return foos;
};
