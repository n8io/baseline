import type { Actor } from "@n8io/baseline-authn";
import type { Id } from "@n8io/baseline-id";
import { err, ok, type Result } from "@n8io/baseline-result";
import { z } from "zod";
import { idSchemaCreate } from "../../../id-schema.ts";
import { FooForbiddenError } from "./errors.ts";
import { type Foo, fooCanUpdate } from "./foo.ts";

// The context's second Model: a short note on one Foo. A Bar holds its Foo's id, never the
// Foo, and never outlives it: fooDelete deletes a Foo's Bars in the same transaction.
export const Bar = z.object({
	id: idSchemaCreate("bar"),
	fooId: idSchemaCreate("foo"),
	text: z.string().trim().min(1).max(500),
	// The creating Actor's id.
	createdBy: z.string(),
	createdAt: z.date(),
});
export type Bar = Readonly<z.infer<typeof Bar>>;

export const BarCreateInput = Bar.pick({ fooId: true, text: true });
export type BarCreateInput = Readonly<z.infer<typeof BarCreateInput>>;

export const BarListInput = Bar.pick({ fooId: true });
export type BarListInput = Readonly<z.infer<typeof BarListInput>>;

// A new Bar on a Foo. Taking the Foo, not its id, means a Bar is only ever built for a Foo that was
// found; whoever may change the Foo may add a Bar to it.
export const barNew = ({
	actor,
	foo,
	id,
	input,
	now,
}: {
	actor: Actor;
	foo: Foo;
	id: Id<"bar">;
	input: Pick<BarCreateInput, "text">;
	now: Date;
}): Result<Bar, FooForbiddenError> =>
	fooCanUpdate(foo, actor)
		? ok({
				id,
				fooId: foo.id,
				text: input.text,
				createdBy: actor.id,
				createdAt: now,
			})
		: err(new FooForbiddenError(foo.id));
