import type { Actor } from "@n8io/baseline-authn";
import type { Consumer, Schedule } from "@n8io/baseline-queue";
import type { Env, Hono, Schema } from "hono";
import { fooContextCreate } from "#contexts/foo/index.ts";
import type { Connections } from "./connections.ts";

// What a context's interface returns for the composition roots to mount: the Server mounts its
// routes, the Worker runs its handlers and schedules, the seed runs its seeds.
export type ContextMounts = {
	routes: { path: string; router: Hono<Env, Schema, string> }[];
	// piece-start: queue
	handlers: Consumer[];
	schedules: Schedule[];
	// piece-end: queue
	seeds: ((actor: Actor) => Promise<unknown>)[];
};

// Builds every bounded context from the connections a composition root opened, each after the
// contexts it reads (its upstream). The Server, the Worker, the seed and tests all call
// contextsCreate, so each context is built once and the same way (docs/agents/bridges.md).
// wiring: contexts-start
export const contextsCreate = (connections: Connections) => {
	const fooContext = fooContextCreate({ connections });
	// wiring: contexts
	return {
		fooContext,
		// wiring: contexts-returned
	};
};
export type Contexts = ReturnType<typeof contextsCreate>;
// wiring: contexts-end
