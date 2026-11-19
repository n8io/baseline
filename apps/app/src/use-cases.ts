import { telemetryUseCasesTrace } from "@n8io/baseline-telemetry";
import { fooPortsCreate } from "#contexts/foo/adapters/outbound/index.ts";
import { fooUseCasesCreate } from "#contexts/foo/index.ts";
import type { Connections } from "./connections.ts";

// Builds every Domain's Use cases, traced, from the connections a composition root opened. The
// Server, the Worker, the seed and tests all call domainsUseCasesCreate, so each Bridge is wired
// once. A Domain that reads another is built after it, with its Bridge (docs/agents/bridges.md).
// (Below the imports: a Project with no Domain yet keeps this comment when its imports go.)
// wiring: contexts-start
export const domainsUseCasesCreate = (connections: Connections) => {
	const fooUseCases = telemetryUseCasesTrace(
		fooUseCasesCreate(fooPortsCreate(connections)),
	);
	// wiring: use-cases
	return {
		fooUseCases,
		// wiring: use-cases-returned
	};
};
export type DomainsUseCases = ReturnType<typeof domainsUseCasesCreate>;
// wiring: contexts-end
