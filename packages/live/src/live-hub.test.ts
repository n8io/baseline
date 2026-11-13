import { logger } from "@n8io/baseline-logger";
import { afterEach, describe, expect, test, vi } from "vitest";
import { type LiveTransport, liveHubCreate } from "./live-hub.ts";
import { liveAppCreate } from "./live-test-app.ts";
import { liveTestSseRead } from "./live-test-sse.ts";

const transportDown: LiveTransport = {
	close: async () => {},
	publish: async () => {
		throw new Error("Transport is down");
	},
	subscribe: async () => {},
};

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("liveHubCreate", () => {
	test("send resolves when the transport fails, and warns", async () => {
		const warn = vi.spyOn(logger, "warn").mockReturnValue();
		await using liveHub = liveHubCreate(transportDown);

		expect(
			await liveHub.send("foo", { id: "foo_1", type: "foo.updated" }),
		).toBeUndefined();
		expect(warn).toHaveBeenCalledExactlyOnceWith(
			{ channel: "foo", err: new Error("Transport is down"), unlogged: 0 },
			"Live update not sent",
		);
	});

	test("warns once per 30 s, with how many failures went unlogged", async () => {
		vi.useFakeTimers();
		const warn = vi.spyOn(logger, "warn").mockReturnValue();
		await using liveHub = liveHubCreate(transportDown);
		const send = () =>
			liveHub.send("foo", { id: "foo_1", type: "foo.updated" });

		for (let call = 0; call < 5; call += 1) await send();
		expect(warn).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(30_000);
		await send();
		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn).toHaveBeenLastCalledWith(
			expect.objectContaining({ unlogged: 4 }),
			"Live update not sent",
		);
	});

	test("when the transport may have lost updates, each open stream gets ready again within 5 s", async () => {
		vi.useFakeTimers({
			toFake: ["clearTimeout", "Date", "setInterval", "setTimeout"],
		});
		let lost = (): void => {};
		await using liveHub = liveHubCreate({
			close: async () => {},
			publish: async () => {},
			resyncListen: (resync) => {
				lost = resync;
			},
			subscribe: async () => {},
		});
		const app = liveAppCreate(liveHub);
		const first = liveTestSseRead({
			response: await app.request("/live/foo/foo_1"),
		});
		const second = liveTestSseRead({
			response: await app.request("/live/bar/bar_1"),
		});
		const gone = liveTestSseRead({
			response: await app.request("/live/foo/foo_2"),
		});
		await first.until("event: ready");
		await second.until("event: ready");
		await gone.until("event: ready");
		await gone.cancel();

		lost();
		// A second loss before the first is told is still one ready.
		lost();
		await vi.advanceTimersByTimeAsync(999);
		await vi.advanceTimersByTimeAsync(4001);
		await liveHub.close();

		const twice =
			/^event: ready\ndata: \n\nevent: ready\ndata: \n\nretry: \d+\n\n$/;
		expect(await first.end()).toMatch(twice);
		expect(await second.end()).toMatch(twice);
	});
});
