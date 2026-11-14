// What the dev server's re-run of server.ts closes first. `pnpm piece-remove ui` deletes this file.
import type { ShutdownStep } from "@n8io/baseline-shutdown";

// Shutdown order: intakes, then resources, health last.
export const serverDevCloseCreate = ({
	connections,
	health,
}: {
	connections: { intakes: ShutdownStep[]; resources: ShutdownStep[] };
	health: { close: () => Promise<void> };
}): (() => Promise<void>) => {
	return async () => {
		for (const step of [...connections.intakes, ...connections.resources]) {
			await step.close();
		}
		await health.close();
	};
};
