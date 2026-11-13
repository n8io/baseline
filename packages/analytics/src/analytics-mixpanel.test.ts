import { setTimeout } from "node:timers/promises";
import { logger } from "@n8io/baseline-logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsMixpanelCreate } from "./analytics-mixpanel.ts";

// Stands in for Mixpanel: each request stays open until the test answers it.
const requestsCatch = () => {
	const requests: {
		url: string;
		init: RequestInit;
		answer: (response: Response | Error) => void;
	}[] = [];
	vi.stubGlobal(
		"fetch",
		(url: string, init: RequestInit) =>
			new Promise<Response>((resolve, reject) => {
				requests.push({
					answer: (response) =>
						response instanceof Error ? reject(response) : resolve(response),
					init,
					url,
				});
			}),
	);
	return requests;
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("analyticsMixpanelCreate", () => {
	it("posts the event to /track with the token and the Actor's id as distinct_id", () => {
		const requests = requestsCatch();
		const analytics = analyticsMixpanelCreate({ token: "token" });

		analytics.track({
			actorId: "user-1",
			name: "foo.created",
			properties: { fooId: "foo_1" },
		});

		expect(requests.map((r) => r.url)).toEqual([
			"https://api.mixpanel.com/track?ip=0&strict=1",
		]);
		expect(requests[0]?.init.method).toBe("POST");
		expect(JSON.parse(String(requests[0]?.init.body))).toEqual([
			{
				event: "foo.created",
				properties: { distinct_id: "user-1", fooId: "foo_1", token: "token" },
			},
		]);
		expect(requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
	});

	it("posts to vendor.host when one is given", () => {
		const requests = requestsCatch();
		const analytics = analyticsMixpanelCreate({
			token: "token",
			vendor: { host: "api-eu.mixpanel.com" },
		});

		analytics.track({ actorId: "user-1", name: "foo.created" });

		expect(requests.map((r) => r.url)).toEqual([
			"https://api-eu.mixpanel.com/track?ip=0&strict=1",
		]);
	});

	it.each([
		"",
		"https://api-eu.mixpanel.com",
		"api-eu.mixpanel.com/",
		"evil.example/x?",
	])("refuses vendor.host %j, which is not a bare host name", (host) => {
		expect(() =>
			analyticsMixpanelCreate({ token: "token", vendor: { host } }),
		).toThrow(/vendor\.host must be a bare host name/);
	});

	it("returns before the send ends, and close waits for it", async () => {
		const requests = requestsCatch();
		const analytics = analyticsMixpanelCreate({ token: "token" });
		analytics.track({ actorId: "user-1", name: "foo.created" });
		let closed = false;

		const closing = analytics.close().then(() => {
			closed = true;
		});
		await Promise.resolve();
		expect(closed).toBe(false);

		requests[0]?.answer(new Response("{}"));
		await closing;
		expect(closed).toBe(true);
	});

	it("await using waits for the send in flight when its block ends", async () => {
		const requests = requestsCatch();
		let closed = false;

		const block = (async () => {
			await using analytics = analyticsMixpanelCreate({ token: "token" });
			analytics.track({ actorId: "user-1", name: "foo.created" });
		})().then(() => {
			closed = true;
		});
		await setTimeout(10);
		expect(closed).toBe(false);

		requests[0]?.answer(new Response("{}"));
		await block;
		expect(closed).toBe(true);
	});

	it.each([
		["a failed request", new Error("connect ECONNREFUSED")],
		["an error status", new Response("{}", { status: 400 })],
	])("logs and drops the event on %s", async (_, answer) => {
		const requests = requestsCatch();
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const analytics = analyticsMixpanelCreate({ token: "token" });

		analytics.track({ actorId: "user-1", name: "foo.created" });
		requests[0]?.answer(answer);
		await analytics.close();

		expect(warn).toHaveBeenCalledWith(
			{ err: expect.any(Error), event: "foo.created" },
			"Dropped an analytics event",
		);
	});
});
