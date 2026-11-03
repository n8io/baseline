import type { Actor } from "@n8io/baseline-authn";
import type { Foo } from "../models/foo.ts";

// The owner or a holder of foo:delete may delete a foo.
export const fooDeletable = (foo: Foo, actor: Actor): boolean =>
	actor.scopes.includes("foo:delete") || foo.createdBy === actor.id;
