import { z } from "zod";
import { Foo } from "../../domain/foo.ts";

// Foo as the cache reads it back: JSON turns dates into strings, so they are coerced back.
// With Foo itself every read would fail the parse and miss.
export const fooCached = Foo.extend({
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
	archivedAt: z.coerce.date().nullable(),
});
