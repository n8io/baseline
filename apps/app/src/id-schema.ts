import { type Id, idPatternCreate } from "@n8io/baseline-id";
import { z } from "zod";

// Accepts only ids with exactly this prefix: an id with another prefix never passes.
export const idSchemaCreate = <P extends string>(prefix: P): z.ZodType<Id<P>> =>
	z
		.string()
		.regex(idPatternCreate(prefix), `Expected a ${prefix} id`) as z.ZodType<
		Id<P>
	>;
