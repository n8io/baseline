import { z } from "zod";

/** Who is performing a use case: a signed-in user or a machine client. */
export type Actor = { id: string; kind: "user" | "client"; scopes: string[] };

export const Actor: z.ZodType<Actor> = z.object({
	id: z.string().min(1),
	kind: z.enum(["user", "client"]),
	scopes: z.array(z.string()),
});
