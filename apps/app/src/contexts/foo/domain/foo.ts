import type { Actor } from "@n8io/baseline-authn";
import type { Id } from "@n8io/baseline-id";
import { err, ok, type Result } from "@n8io/baseline-result";
import { z } from "zod";
import { idSchemaCreate } from "../../../id-schema.ts";
import { FooForbiddenError } from "./errors.ts";

// Schema casing: a schema that doubles as its type is PascalCase (Foo, FooCreateInput, and the
// API's FooResponse). A Domain event schema is camelCase (fooCreated) beside its PascalCase type.
export const Foo = z.object({
	id: idSchemaCreate("foo"),
	name: z.string().trim().min(1).max(100),
	// The creating Actor's id.
	createdBy: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	archivedAt: z.date().nullable(),
});
export type Foo = Readonly<z.infer<typeof Foo>>;

export const FooCreateInput = Foo.pick({ name: true });
export type FooCreateInput = Readonly<z.infer<typeof FooCreateInput>>;

export const FooGetInput = z.object({ fooId: idSchemaCreate("foo") });
export type FooGetInput = Readonly<z.infer<typeof FooGetInput>>;

export const FooUpdateInput = z.object({
	fooId: idSchemaCreate("foo"),
	name: Foo.shape.name,
});
export type FooUpdateInput = Readonly<z.infer<typeof FooUpdateInput>>;

export const FooDeleteInput = z.object({ fooId: idSchemaCreate("foo") });
export type FooDeleteInput = Readonly<z.infer<typeof FooDeleteInput>>;

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
export type FooListInput = Readonly<z.infer<typeof FooListInput>>;

export type FooList = {
	readonly items: readonly Foo[];
	readonly nextCursor: string | null;
	readonly total?: number;
};

// Foo guards its invariants here: a Use case builds or changes a Foo only through these, so it
// cannot save one that breaks an Invariant. Each is pure; the Use case passes in the id and the time.

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
export const fooCanUpdate = (foo: Foo, actor: Actor): boolean =>
	actor.scopes.includes("foo:update") || foo.createdBy === actor.id;

// The owner or a holder of foo:delete may delete a foo.
export const fooCanDelete = (foo: Foo, actor: Actor): boolean =>
	actor.scopes.includes("foo:delete") || foo.createdBy === actor.id;

export const fooRename = (
	foo: Foo,
	{ actor, name, now }: { actor: Actor; name: string; now: Date },
): Result<Foo, FooForbiddenError> =>
	fooCanUpdate(foo, actor)
		? ok({ ...foo, name, updatedAt: now })
		: err(new FooForbiddenError(foo.id));

// model-create-start: schedule
export const FOO_STALE_DAYS = 30;

// A foo nobody has changed since this cut-off, and that is not archived yet, is stale.
export const fooStaleBefore = (now: Date): Date =>
	new Date(now.getTime() - FOO_STALE_DAYS * 86_400_000);
// model-create-end: schedule

// piece-start: queue
export const fooCreated = z.object({ fooId: idSchemaCreate("foo") });
export type FooCreated = Readonly<z.infer<typeof fooCreated>>;

export const fooDeleted = z.object({ fooId: idSchemaCreate("foo") });
export type FooDeleted = Readonly<z.infer<typeof fooDeleted>>;

export type FooEventMap = {
	"foo.created": FooCreated;
	"foo.deleted": FooDeleted;
};
// piece-end: queue
