// The context's interface: outside code imports only this file. fooContextCreate builds the
// context and hands back what the composition roots mount; the rest is its Published language.

import type { Actor } from "@n8io/baseline-authn";
import { telemetryUseCasesTrace } from "@n8io/baseline-telemetry";
import type { Connections } from "../../connections.ts";
import { barRoutesCreate } from "./adapters/inbound/bar-routes.ts";
import { fooLiveRoutesCreate } from "./adapters/inbound/foo-live-routes.ts";
import { fooRoutesCreate } from "./adapters/inbound/foo-routes.ts";
import {
	fooSchedule,
	fooScheduleCreate,
} from "./adapters/inbound/foo-schedule.ts";
import { fooSeed } from "./adapters/inbound/foo-seed.ts";
import { fooPortsCreate } from "./adapters/outbound/index.ts";
import { fooUseCasesCreate } from "./application/foo-use-cases.ts";

// Picks the context's adapters from the connections a composition root opened, and traces every
// Use case. Each part comes only with its piece: handlers and schedules with the queue.
export const fooContextCreate = ({
	connections,
}: {
	connections: Connections;
}) => {
	const useCases = telemetryUseCasesTrace(
		fooUseCasesCreate(fooPortsCreate(connections)),
	);
	return {
		useCases,
		routes: [
			{ path: "/api/v1/foos", router: fooRoutesCreate(useCases) },
			{ path: "/api/v1/foos", router: barRoutesCreate(useCases) },
			// piece-start: live
			{
				path: "/live/foo",
				router: fooLiveRoutesCreate(useCases, connections.liveHub),
			},
			// piece-end: live
			// wiring: routes
		],
		// piece-start: queue
		handlers: [
			// wiring: handlers
		],
		schedules: [
			fooScheduleCreate(useCases),
			// wiring: schedules
		],
		// piece-end: queue
		// Development rows, one seed per Aggregate, run in this order.
		seeds: [
			(actor: Actor) => fooSeed(useCases, actor),
			// wiring: seeds
		],
	};
};
// What the context hands back: a downstream context's ACL reads it through its useCases.
export type FooContext = ReturnType<typeof fooContextCreate>;

// The Published language: what the UI and other contexts may use.
export type { FooUseCases } from "./application/foo-use-cases.ts";
export { type Bar, BarCreateInput, BarListInput } from "./domain/bar.ts";
export * from "./domain/errors.ts";
export {
	Foo,
	FooCreateInput,
	FooDeleteInput,
	FooGetInput,
	type FooList,
	FooListInput,
	FooUpdateInput,
	fooDeleteCan,
	fooUpdateCan,
} from "./domain/foo.ts";
export { fooErrorStatus } from "./foo-error-status.ts";

// Scopes an actor may hold to change other people's foos.
export const fooScopes = ["foo:update", "foo:delete"] as const;
// wiring: exports

// piece-start: queue
// The Domain events about a foo, which other contexts may handle.
export {
	type FooCreated,
	type FooDeleted,
	type FooEventMap,
	fooCreated,
	fooDeleted,
} from "./domain/foo.ts";
// wiring: events
// The Schedules' names and crons: migrate syncs them before any connection opens.
export const fooSchedules: { cron: string; name: string }[] = [
	fooSchedule,
	// wiring: schedule-definitions
];
// piece-end: queue
