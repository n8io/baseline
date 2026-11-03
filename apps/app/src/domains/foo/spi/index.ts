import type { LiveHub } from "@n8io/baseline-live";
import type { FooPorts } from "../ports.ts";
import { fooPortsMemory } from "./foo-ports.memory.ts";

// Picks the adapters for each port. Memory only for now; the Postgres and Redis adapters
// join with the foo SPI step. Composition roots own every connection.
export const fooPortsCreate = (options: {
	database: "memory";
	cache: "memory";
	queue: "memory";
	liveHub: LiveHub;
}): FooPorts => ({
	...fooPortsMemory().ports,
	fooLiveUpdates: { send: (update) => options.liveHub.send("foo", update) },
});
