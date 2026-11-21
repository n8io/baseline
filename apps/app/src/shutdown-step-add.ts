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
