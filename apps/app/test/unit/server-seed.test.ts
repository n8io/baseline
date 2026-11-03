import { afterEach, describe, expect, it, vi } from "vitest";

const seedsRun = vi.fn(async () => {});

vi.mock("react-router-hono-server/node", () => ({
	createHonoServer: async (options: unknown) => options,
}));
vi.mock("@n8io/baseline-health", () => ({
	healthServerCreate: () => ({ close: async () => {}, ready: () => {} }),
}));
vi.mock("../../src/seed.ts", () => ({ seedsRun }));

afterEach(() => {
	vi.doUnmock("varlock/env");
	seedsRun.mockClear();
});

// Imports server.ts fresh with .env.test's values and the given overrides.
const serverImport = async (env: Record<string, string>) => {
	const actual =
		await vi.importActual<typeof import("varlock/env")>("varlock/env");
	vi.resetModules();
	// varlock's ENV is a proxy, so read through it instead of spreading it.
	const ENV = new Proxy(env, {
		get: (target, key: string) => target[key] ?? Reflect.get(actual.ENV, key),
	});
	vi.doMock("varlock/env", () => ({ ENV }));
	await import("../../src/server.ts");
};

describe("server.ts seeding", () => {
	it("seeds a memory database at every development start", async () => {
		await serverImport({ APP_ENV: "development" });
		expect(seedsRun).toHaveBeenCalledOnce();
		expect(seedsRun).toHaveBeenCalledWith(
			expect.objectContaining({
				fooUseCases: expect.objectContaining({
					fooCreate: expect.any(Function),
				}),
			}),
		);
	});

	it("never seeds in test", async () => {
		await serverImport({ APP_ENV: "test" });
		expect(seedsRun).not.toHaveBeenCalled();
	});
});
