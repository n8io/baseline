import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import {
	type OtlpReceiver,
	otlpEnv,
	otlpReceiverStart,
} from "./otlp-receiver.ts";
import {
	type ProductionServer,
	productionServerStart,
} from "./production-server.ts";
import { signIn } from "./sign-in.ts";

let receiver: OtlpReceiver;
let server: ProductionServer;
let drop: () => Promise<void>;

beforeAll(async () => {
	receiver = await otlpReceiverStart();
	const database = await integrationDatabaseCreate();
	drop = database.drop;
	server = await productionServerStart({
		cacheUrl: inject("integrationCacheUrl"),
		databaseUrl: database.databaseUrl,
		env: otlpEnv(receiver),
	});
	const session = await signIn(server.url);
	const res = await fetch(`${server.url}/api/v1/foos`, {
		body: JSON.stringify({ name: "Metered" }),
		headers: {
			authorization: session.authorization,
			"content-type": "application/json",
		},
		method: "POST",
	});
	expect(res.status).toBe(201);
	// SIGTERM ends with telemetryShutdown, which exports the last metrics.
	await server.stop();
}, 60_000);

afterAll(async () => {
	await server?.stop();
	await receiver?.close();
	await drop?.();
});

describe("metrics from the production build", { timeout: 30_000 }, () => {
	it("exports baseline.use_case.duration for a foo request over OTLP", () => {
		const points = receiver
			.metrics()
			.filter((metric) => metric.name === "baseline.use_case.duration")
			.flatMap((metric) => metric.histogram?.dataPoints ?? [])
			.filter((point) =>
				point.attributes.some(
					(item) =>
						item.key === "code.function.name" &&
						item.value.stringValue === "fooCreate",
				),
			);
		expect(points.length).toBeGreaterThan(0);
		expect(points.every((point) => Number(point.count) > 0)).toBe(true);
	});
});
