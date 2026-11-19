import { z } from "zod";
import { idSchemaCreate } from "../../../id-schema.ts";

// The context's second Aggregate: a short note on one Foo. A Bar holds its Foo's id, never the
// Foo, and never outlives it: fooDelete deletes a Foo's Bars in the same transaction.
export const Bar = z.object({
	id: idSchemaCreate("bar"),
	fooId: idSchemaCreate("foo"),
	text: z.string().trim().min(1).max(500),
	// The creating Actor's id.
	createdBy: z.string(),
	createdAt: z.date(),
});
export type Bar = z.infer<typeof Bar>;

export const BarCreateInput = Bar.pick({ fooId: true, text: true });
export type BarCreateInput = z.infer<typeof BarCreateInput>;

export const BarListInput = Bar.pick({ fooId: true });
export type BarListInput = z.infer<typeof BarListInput>;
