import { once } from "node:events";
import { createServer as netServerCreate, type Server } from "node:net";

// The ports integration tests hand the Servers and Workers they boot. Every Project's test run on
// this machine claims from the same range, below the kernel's ephemeral range (32768 and up on
// Linux, 49152 on macOS) and above the host ports app-create gives Projects (20000 to 29999).
//
// A free port is free only until its probe closes: the child binds it seconds later. Two runs that
// probed the same port would both start a child on it, and one test would talk to the other run's
// Server. So a run first claims the port: it listens on the port's guard, `span` above it, and keeps
// that socket open. The OS lets one process listen on a port, and closes the socket when that process
// exits however it exits, so a claim can never be shared or left behind. A Vitest worker reuses its
// claims, so a run holds a few ports per worker, not one per test.

type PortClaimer = { claim: () => Promise<number> };

// Claims a worker makes before it reuses one, so a port a test just stopped rests for a while.
const claimsBeforeReuse = 10;

// A socket listening on `port`, or undefined when something else already does.
const portListen = async (port: number): Promise<Server | undefined> => {
	const server = netServerCreate().listen(port);
	// once() rejects when the server emits "error" (EADDRINUSE) first.
	return once(server, "listening").then(
		() => server,
		() => undefined,
	);
};

// Nothing listens on `port` right now, e.g. a child an earlier file leaked.
const portIsFree = async (port: number): Promise<boolean> => {
	const probe = await portListen(port);
	if (probe === undefined) return false;
	await new Promise((resolve) => probe.close(resolve));
	return true;
};

/** Claims from `first` to `first + span - 1`; their guards are the `span` ports after them. */
export const integrationPortClaimerCreate = ({
	first = 30_000,
	span = 1_384,
}: {
	first?: number;
	span?: number;
} = {}): PortClaimer => {
	const claimed: number[] = [];
	let next = 0;

	return {
		// A new claim until the worker holds claimsBeforeReuse, then the next of its own that nothing
		// listens on, round robin; a new claim again when every one is busy.
		claim: async () => {
			const reusable = claimed.length < claimsBeforeReuse ? 0 : claimed.length;
			for (let tries = 0; tries < reusable; tries++) {
				const port = claimed[next++ % claimed.length] as number;
				if (await portIsFree(port)) return port;
			}
			for (let port = first; port < first + span; port++) {
				if (claimed.includes(port)) continue;
				const guard = await portListen(port + span);
				if (guard === undefined) continue;
				// The guard must not keep the worker alive once its tests are done.
				guard.unref();
				claimed.push(port);
				if (await portIsFree(port)) return port;
			}
			throw new Error(`no free port in ${first}-${first + span - 1}`);
		},
	};
};
