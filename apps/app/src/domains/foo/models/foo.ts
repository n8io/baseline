import { idSchemaCreate } from "@n8io/baseline-id";
import { z } from "zod";

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
