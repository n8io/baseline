import { setTimeout } from "node:timers/promises";
import { type Logger, logger } from "@n8io/baseline-logger";
import { afterEach, describe, expect, it } from "vitest";
import { analyticsMixpanelCreate } from "./analytics-mixpanel.ts";

type LogCall = [fields: unknown, message?: string];

const restores: (() => void)[] = [];

// A hand-written recording double for one logger method, put back by afterEach.
const loggerRecord = (method: "warn") => {
	const calls: LogCall[] = [];
	const original = logger[method];
	logger[method] = ((...args: LogCall) => {
		calls.push(args);
	}) as Logger[typeof method];
	restores.push(() => {
		logger[method] = original;
	});
	return calls;
};

const fetchOriginal = globalThis.fetch;

// Stands in for Mixpanel: each request stays open until the test answers it.
const requestsCatch = () => {
	const requests: {
		url: string;
		init: RequestInit;
		answer: (response: Response | Error) => void;
	}[] = [];
	globalThis.fetch = ((url: string, init: RequestInit) =>
		new Promise<Response>((resolve, reject) => {
			requests.push({
				answer: (response) =>
					response instanceof Error ? reject(response) : resolve(response),
				init,
				url,
			});
		})) as typeof fetch;
	return requests;
};

afterEach(() => {
	globalThis.fetch = fetchOriginal;
	for (const restore of restores.splice(0)) restore();
});

describe("analyticsMixpanelCreate", () => {
	it("posts the event to /track with the token and the Actor's id as distinct_id", async () => {
		const requests = requestsCatch();
		await using analytics = analyticsMixpanelCreate({ token: "token" });

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
		requests[0]?.answer(new Response("{}"));
	});

	it("posts to vendor.host when one is given", async () => {
		const requests = requestsCatch();
		await using analytics = analyticsMixpanelCreate({
			token: "token",
			vendor: { host: "api-eu.mixpanel.com" },
		});

		analytics.track({ actorId: "user-1", name: "foo.created" });

		expect(requests.map((r) => r.url)).toEqual([
			"https://api-eu.mixpanel.com/track?ip=0&strict=1",
		]);
		requests[0]?.answer(new Response("{}"));
	});

	it.each([
		"",
		"https://api-eu.mixpanel.com",
		"api-eu.mixpanel.com/",
		"evil.example/x?",
	])("refuses vendor.host %j, which is not a bare host name", (host) => {
		expect(() =>
			analyticsMixpanelCreate({ token: "token", vendor: { host } }),
		).toThrow(
			/^analyticsMixpanelCreate: vendor\.host must be a bare host name/,
		);
	});

	it("takes a null vendor or vendor.host as left out", () => {
		const requests = requestsCatch();

		analyticsMixpanelCreate({ token: "token", vendor: null }).track({
			actorId: "user-1",
			name: "foo.created",
		});
		analyticsMixpanelCreate({ token: "token", vendor: { host: null } }).track({
			actorId: "user-1",
			name: "foo.created",
		});

		expect(requests.map((r) => r.url)).toEqual([
			"https://api.mixpanel.com/track?ip=0&strict=1",
			"https://api.mixpanel.com/track?ip=0&strict=1",
		]);
	});

	it("refuses an empty token", () => {
		const create = () => analyticsMixpanelCreate({ token: "" });

		expect(create).toThrow(TypeError);
		expect(create).toThrow("analyticsMixpanelCreate: token must not be empty");
	});

	it("sends an event whose properties are null like one without", async () => {
		const requests = requestsCatch();
		await using analytics = analyticsMixpanelCreate({ token: "token" });

		analytics.track({
			actorId: "user-1",
			name: "foo.created",
			properties: null,
		});

		expect(JSON.parse(String(requests[0]?.init.body))).toEqual([
			{
				event: "foo.created",
				properties: { distinct_id: "user-1", token: "token" },
			},
		]);
		requests[0]?.answer(new Response("{}"));
	});

	it("refuses a vendor key other than host, since it would do nothing", () => {
		const create = () =>
			analyticsMixpanelCreate({
				token: "token",
				vendor: { geolocate: true } as never,
			});

		expect(create).toThrow(TypeError);
		expect(create).toThrow(
			"analyticsMixpanelCreate: vendor.geolocate is not allowed: only host reaches Mixpanel",
		);
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
		const warn = loggerRecord("warn");
		const analytics = analyticsMixpanelCreate({ token: "token" });

		analytics.track({ actorId: "user-1", name: "foo.created" });
		requests[0]?.answer(answer);
		await analytics.close();

		expect(warn).toEqual([
			[
				{ err: expect.any(Error), event: "foo.created" },
				"Dropped an analytics event",
			],
		]);
	});
});
