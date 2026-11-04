import { afterEach, describe, expect, it, vi } from "vitest";

const healthServers: Array<{ close: () => Promise<void>; ready: () => void }> =
	[];
const healthServerCreate = vi.fn(() => {
	const server = { close: vi.fn(async () => {}), ready: () => {} };
	healthServers.push(server);
	return server;
});
const liveClose = vi.fn(async () => {});

vi.mock("react-router-hono-server/node", () => ({
	createHonoServer: async (options: unknown) => options,
}));
vi.mock("@n8io/baseline-health", () => ({ healthServerCreate }));
vi.mock("@n8io/baseline-live", async (importOriginal) => {
	const original = await importOriginal<typeof import("@n8io/baseline-live")>();
	return {
		...original,
		liveMemory: () => ({ ...original.liveMemory(), close: liveClose }),
	};
});

afterEach(() => {
	delete (globalThis as { serverDevClose?: unknown }).serverDevClose;
});

// What the dev server does after an edit: evaluate server.ts again in the same process.
const serverRun = async () => {
	vi.resetModules();
	await import("./server.ts");
};

describe("server.ts re-run in development", () => {
	it("closes the last run's live hub, then its health server, before listening again", async () => {
		await serverRun();
		await serverRun();

		expect(healthServerCreate).toHaveBeenCalledTimes(2);
		const [first, second] = healthServers;
		expect(first?.close).toHaveBeenCalledOnce();
		expect(second?.close).not.toHaveBeenCalled();
		expect(liveClose).toHaveBeenCalledOnce();

		const order = (fn: unknown, call = 0) =>
			vi.mocked(fn as () => unknown).mock.invocationCallOrder[call] ?? 0;
		expect(order(liveClose)).toBeLessThan(order(first?.close));
		expect(order(first?.close)).toBeLessThan(order(healthServerCreate, 1));
	});
});
