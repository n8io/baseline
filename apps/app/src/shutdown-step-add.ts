// How an entry point lists what to close: a step goes to the front or the back of a group,
// and the list it came from is not changed.
import type { ShutdownStep } from "@n8io/baseline-shutdown";

export type ShutdownSteps = {
	intakes: ShutdownStep[];
	resources: ShutdownStep[];
};

export const shutdownStepAdd = ({
	at,
	group,
	step,
	steps,
}: {
	at: "first" | "last";
	group: "intakes" | "resources";
	step: ShutdownStep;
	steps: ShutdownSteps;
}): ShutdownSteps => ({
	...steps,
	[group]: at === "first" ? [step, ...steps[group]] : [...steps[group], step],
});

// A resource an entry point opened, added so shutdown closes it: `close` defaults to the
// resource's own, and a resource that needs more than that passes it.
export const resourceOpen = <Resource extends { close: () => unknown }>({
	at,
	close,
	group,
	name,
	resource,
	steps,
}: {
	at: "first" | "last";
	close?: ((resource: Resource) => unknown) | null;
	group: "intakes" | "resources";
	name: string;
	resource: Resource;
	steps: ShutdownSteps;
}): ShutdownSteps =>
	shutdownStepAdd({
		at,
		group,
		step: {
			close: async () => void (await (close ?? ((r) => r.close()))(resource)),
			name,
		},
		steps,
	});
