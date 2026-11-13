import { z } from "zod";
import type { Actor } from "./actor.ts";

// Internal: what `actorFromClaims` returns is parsed with it. The package exports only the type, so
// no caller needs Zod.
export const actorSchema: z.ZodType<Actor> = z.object({
	id: z.string().min(1),
	kind: z.enum(["user", "client"]),
	scopes: z.array(z.string()),
});
