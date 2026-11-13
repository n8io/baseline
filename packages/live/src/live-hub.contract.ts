import { describe, expect, test } from "vitest";
import type { LiveHub } from "./index.ts";
import { liveAppCreate } from "./live-test-app.ts";
import { liveTestSseRead } from "./live-test-sse.ts";

// The behaviour a LiveHub must have on every transport, seen through its streams.
export const liveHubContract = (
	liveHubCreate: () => Promise<LiveHub>,
): void => {
	describe("live hub contract", () => {
		const open = async (liveHub: LiveHub, path: string) => {
			const sse = liveTestSseRead({
				response: await liveAppCreate(liveHub).request(path),
			});
			await sse.until("event: ready");
			return sse;
		};

		test("sends { type, id } for its own (channel, id) only", async () => {
			const liveHub = await liveHubCreate();
			const sse = await open(liveHub, "/live/foo/foo_1");

			await liveHub.send("foo", { id: "foo_2", type: "foo.updated" });
			await liveHub.send("bar", { id: "foo_1", type: "bar.updated" });
			await liveHub.send("foo", { id: "foo_1", type: "foo.updated" });

			expect(await sse.until("foo.updated")).toBe(
				'event: ready\ndata: \n\ndata: {"id":"foo_1","type":"foo.updated"}\n\n',
			);
			await liveHub.close();
		});

		test("sends only type and id, whatever else the sender passes", async () => {
			const liveHub = await liveHubCreate();
			const sse = await open(liveHub, "/live/foo/foo_1");

			const update = { id: "foo_1", name: "secret", type: "foo.updated" };
			await liveHub.send("foo", update);

			expect(await sse.until("foo.updated")).not.toContain("secret");
			await liveHub.close();
		});

		test("close() sends every stream a retry, closes it, then resolves", async () => {
			const liveHub = await liveHubCreate();
			const first = await open(liveHub, "/live/foo/foo_1");
			const second = await open(liveHub, "/live/foo/foo_2");

			await liveHub.close();

			expect(await first.end()).toMatch(/retry: \d+\n\n$/);
			expect(await second.end()).toMatch(/retry: \d+\n\n$/);
		});

		test("a stream opened after close ends at once with a retry", async () => {
			const liveHub = await liveHubCreate();
			await liveHub.close();

			const response = await liveAppCreate(liveHub).request("/live/foo/foo_1");

			expect(await liveTestSseRead({ response }).end()).toMatch(
				/^retry: \d+\n\n$/,
			);
		});
	});
};
