import type { Actor } from "@n8io/baseline-authn";
import type { Id } from "@n8io/baseline-id";
import { err, ok, type Result } from "@n8io/baseline-result";
import { z } from "zod";
import { idSchemaCreate } from "../../../id-schema.ts";
import { FooForbiddenError } from "./errors.ts";

// Schema casing: an Aggregate's schema and its input schemas are PascalCase and double as their
// type. Every other schema is camelCase beside a PascalCase type: a Domain event is the Aggregate
// and a past-tense verb (`invoiceCreated`), a cached copy ends in `Cached`.
export const Foo = z.object({
	id: idSchemaCreate("foo"),
	name: z.string().trim().min(1).max(100),
	// The creating Actor's id.
	createdBy: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	archivedAt: z.date().nullable(),
});
export type Foo = z.infer<typeof Foo>;

export const FooCreateInput = Foo.pick({ name: true });
export type FooCreateInput = z.infer<typeof FooCreateInput>;

export const FooGetInput = z.object({ fooId: idSchemaCreate("foo") });
export type FooGetInput = z.infer<typeof FooGetInput>;

export const FooUpdateInput = z.object({
	fooId: idSchemaCreate("foo"),
	name: Foo.shape.name,
});
export type FooUpdateInput = z.infer<typeof FooUpdateInput>;

export const FooDeleteInput = z.object({ fooId: idSchemaCreate("foo") });
export type FooDeleteInput = z.infer<typeof FooDeleteInput>;

export const FooListInput = z.object({
	limit: z.number().int().min(1).max(100).default(50),
	cursor: z.string().optional(),
	count: z.boolean().default(false),
	// Named filter: false lists foos still in use, true lists archived ones.
	archived: z.boolean().default(false),
	sort: z
		.enum(["createdAt", "-createdAt", "name", "-name"])
		.default("-createdAt"),
});
export type FooListInput = z.infer<typeof FooListInput>;

export type FooList = {
	items: Foo[];
	nextCursor: string | null;
	total?: number;
};

// Foo guards its invariants here: a Use case builds or changes a Foo only through these, so it
// cannot save one that breaks a rule. Each is pure; the Use case passes in the id and the time.

// A new Foo, owned by the Actor creating it.
export const fooNew = ({
	actor,
	id,
	input,
	now,
}: {
	actor: Actor;
	id: Id<"foo">;
	input: FooCreateInput;
	now: Date;
}): Foo => ({
	id,
	name: input.name,
	createdBy: actor.id,
	createdAt: now,
	updatedAt: now,
	archivedAt: null,
});

// The owner or a holder of foo:update may change a foo.
export const fooUpdateCan = (foo: Foo, actor: Actor): boolean =>
	actor.scopes.includes("foo:update") || foo.createdBy === actor.id;

// The owner or a holder of foo:delete may delete a foo.
export const fooDeleteCan = (foo: Foo, actor: Actor): boolean =>
	actor.scopes.includes("foo:delete") || foo.createdBy === actor.id;

export const fooRename = (
	foo: Foo,
	{ actor, name, now }: { actor: Actor; name: string; now: Date },
): Result<Foo, FooForbiddenError> =>
	fooUpdateCan(foo, actor)
		? ok({ ...foo, name, updatedAt: now })
		: err(new FooForbiddenError(foo.id));

// aggregate-create-start: schedule
export const FOO_STALE_DAYS = 30;

// A foo nobody has changed since this cut-off, and that is not archived yet, is stale.
export const fooStaleBefore = (now: Date): Date =>
	new Date(now.getTime() - FOO_STALE_DAYS * 86_400_000);
// aggregate-create-end: schedule

// piece-start: queue
export const fooCreated = z.object({ fooId: idSchemaCreate("foo") });
export type FooCreated = z.infer<typeof fooCreated>;

export const fooDeleted = z.object({ fooId: idSchemaCreate("foo") });
export type FooDeleted = z.infer<typeof fooDeleted>;

export type FooEventMap = {
	"foo.created": FooCreated;
	"foo.deleted": FooDeleted;
};
// piece-end: queue
