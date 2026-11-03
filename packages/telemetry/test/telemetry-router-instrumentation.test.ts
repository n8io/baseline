import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type TelemetryRouterInstrumentation,
	telemetryRouterInstrumentation,
} from "../src/telemetry-router-instrumentation.ts";
import { spans } from "./telemetry-test-providers.ts";

type RouteInstruments = Parameters<
	Parameters<TelemetryRouterInstrumentation["route"]>[0]["instrument"]
>[0];
type HandlerInstruments = Parameters<
	Parameters<TelemetryRouterInstrumentation["handler"]>[0]["instrument"]
>[0];

// Collects what the instrumentation registers, as React Router would.
const routeInstruments = (): RouteInstruments => {
	let registered: RouteInstruments = {};
	telemetryRouterInstrumentation.route({
		instrument: (instruments) => {
			registered = instruments;
		},
	});
	return registered;
};

const handlerInstruments = (): HandlerInstruments => {
	let registered: HandlerInstruments = {};
	telemetryRouterInstrumentation.handler({
		instrument: (instruments) => {
			registered = instruments;
		},
	});
	return registered;
};

const success = { error: undefined, status: "success" } as const;

class FooLoadFailed extends Error {}

beforeEach(() => {
	spans.reset();
});

describe("telemetryRouterInstrumentation", () => {
	it("names loader and action spans after the route pattern", async () => {
		const { action, loader } = routeInstruments();
		let activeInLoader: unknown;
		await loader?.(
			async () => {
				activeInLoader = trace.getActiveSpan();
				return success;
			},
			{ pattern: "/foos/:fooId" },
		);
		await action?.(async () => success, { pattern: "/foos/:fooId" });
		const finished = spans.getFinishedSpans();
		expect(finished.map((span) => span.name)).toEqual([
			"loader /foos/:fooId",
			"action /foos/:fooId",
		]);
		expect(finished[0]?.kind).toBe(SpanKind.INTERNAL);
		expect(finished[0]?.status.code).toBe(SpanStatusCode.UNSET);
		expect(activeInLoader).toBeDefined();
	});

	it("marks a thrown error with its class name, and a thrown Response as no error", async () => {
		const { loader } = routeInstruments();
		await loader?.(
			async () => ({
				error: new FooLoadFailed("secret detail"),
				status: "error",
			}),
			{ pattern: "/foos" },
		);
		await loader?.(
			async () => ({
				error: new Response(null, { status: 302 }),
				status: "error",
			}),
			{ pattern: "/foos" },
		);
		const [failed, redirected] = spans.getFinishedSpans();
		expect(failed?.status).toEqual({
			code: SpanStatusCode.ERROR,
			message: "FooLoadFailed",
		});
		expect(failed?.attributes["error.type"]).toBe("FooLoadFailed");
		expect(redirected?.status.code).toBe(SpanStatusCode.UNSET);
	});

	it("sets http.route and the server span name from the matched pattern", async () => {
		const { request } = handlerInstruments();
		const server = trace
			.getTracer("test")
			.startSpan("GET", { kind: SpanKind.SERVER });
		await trace
			.getTracer("test")
			.startActiveSpan("GET", { kind: SpanKind.SERVER }, async (active) => {
				await request?.(
					async () => ({ ...success, meta: { pattern: "/foos/:fooId" } }),
					{ request: { method: "GET" } },
				);
				active.end();
			});
		server.end();
		const [named] = spans.getFinishedSpans();
		expect(named?.name).toBe("GET /foos/:fooId");
		expect(named?.attributes["http.route"]).toBe("/foos/:fooId");
	});

	it("leaves the server span alone when no route matched", async () => {
		const { request } = handlerInstruments();
		await trace
			.getTracer("test")
			.startActiveSpan("GET", { kind: SpanKind.SERVER }, async (active) => {
				await request?.(async () => ({ ...success, meta: undefined }), {
					request: { method: "GET" },
				});
				active.end();
			});
		expect(spans.getFinishedSpans()[0]?.name).toBe("GET");
	});
});
