import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { type LiveTransport, liveHubCreate } from "./live-hub.ts";
import { liveTestAppCreate } from "./live-test-app.ts";
import { liveTestSseRead } from "./live-test-sse.ts";

const transportDown: LiveTransport = {
	close: async () => {},
	publish: async () => {
		throw new Error("Transport is down");
	},
	subscribe: async () => {},
};

// A clock the test moves by hand and a logger that records its warnings.
const depsCreate = () => {
	const clock = { at: 0 };
	const warnings: unknown[][] = [];
	return {
		advance: (ms: number) => {
			clock.at += ms;
		},
		logger: { warn: (...args: unknown[]) => void warnings.push(args) },
		now: () => clock.at,
		warnings,
	};
};

describe("liveHubCreate", () => {
	it("send resolves when the transport fails, and warns", async () => {
		const { logger, warnings } = depsCreate();
		await using liveHub = liveHubCreate(transportDown, { logger });

		expect(
			await liveHub.send("foo", { id: "foo_1", type: "foo.updated" }),
		).toBeUndefined();
		expect(warnings).toEqual([
			[
				{ channel: "foo", err: new Error("Transport is down"), unlogged: 0 },
				"Live update not sent",
			],
		]);
	});

	it("warns once per 30 s, with how many failures went unlogged", async () => {
		const { advance, logger, now, warnings } = depsCreate();
		await using liveHub = liveHubCreate(transportDown, { logger, now });
		const send = () =>
			liveHub.send("foo", { id: "foo_1", type: "foo.updated" });

		for (let call = 0; call < 5; call += 1) await send();
		expect(warnings).toHaveLength(1);

		advance(30_000);
		await send();
		expect(warnings).toHaveLength(2);
		expect(warnings.at(-1)).toEqual([
			expect.objectContaining({ unlogged: 4 }),
			"Live update not sent",
		]);
	});

	it("when the transport may have lost updates, each open stream gets ready again once", async () => {
		let lost = (): void => {};
		await using liveHub = liveHubCreate({
			close: async () => {},
			publish: async () => {},
			resyncListen: (resync) => {
				lost = resync;
			},
			subscribe: async () => {},
		});
		const app = liveTestAppCreate(liveHub, { timing: { retryMs: () => 10 } });
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
		const ready = "event: ready\ndata: \n\nevent: ready\ndata: \n\n";
		await first.until(ready);
		await second.until(ready);
		// Long enough for a duplicate ready to arrive, were there one.
		await sleep(40);
		await liveHub.close();

		const twice =
			/^event: ready\ndata: \n\nevent: ready\ndata: \n\nretry: \d+\n\n$/;
		expect(await first.end()).toMatch(twice);
		expect(await second.end()).toMatch(twice);
	});
});
