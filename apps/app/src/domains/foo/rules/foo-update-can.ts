import type { Actor } from "@n8io/baseline-authn";
import type { Foo } from "../models/foo.ts";

// The owner or a holder of foo:update may change a foo.
export const fooUpdateCan = (foo: Foo, actor: Actor): boolean =>
	actor.scopes.includes("foo:update") || foo.createdBy === actor.id;
