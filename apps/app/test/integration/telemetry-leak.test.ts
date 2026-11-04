import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import {
	canaries,
	type OtlpReceiver,
	type OtlpSpan,
	otlpEnv,
	otlpReceiverStart,
	signalsLeaking,
	spanAttribute,
	spanKindServer,
	telemetrySignals,
} from "./otlp-receiver.ts";
import {
	type ProductionServer,
	productionServerStart,
} from "./production-server.ts";
import { type SignedIn, signIn } from "./sign-in.ts";

const clientSecret = `canary-client-secret-${randomUUID()}`;
// The canaries ride in queries and bodies; url.path is exported as is, so none goes there.
const canaryQuery = new URLSearchParams({
	card: canaries.card,
	email: canaries.email,
}).toString();
const canaryBody = JSON.stringify(canaries);

let receiver: OtlpReceiver;
let server: ProductionServer;
let session: SignedIn;
let drop: () => Promise<void>;
let exitCode: number | null;
const responseBodies: string[] = [];

const request = async (path: string, init: RequestInit): Promise<number> => {
	const res = await fetch(`${server.url}${path}`, {
		...init,
		redirect: "manual",
	});
	responseBodies.push(await res.text());
	return res.status;
};

// The whole journey runs once, through routes every project has; each test reads what it left.
beforeAll(async () => {
	receiver = await otlpReceiverStart();
	const database = await integrationDatabaseCreate();
	drop = database.drop;
	server = await productionServerStart({
		cacheUrl: inject("integrationCacheUrl"),
		databaseUrl: database.databaseUrl,
		env: {
			...otlpEnv(receiver),
			AUTHN_CLIENT_SECRET: clientSecret,
			LOG_LEVEL: "trace",
		},
	});
	session = await signIn(server.url);
	// A sign-in that fails validation on a canary.
	expect(
		await request("/auth/sign-in", {
			body: new URLSearchParams({ who: canaries.email }),
			method: "POST",
		}),
	).toBe(400);
	// A page load with the cookie and canaries in the query.
	expect(
		await request(`/no-such-page?${canaryQuery}`, {
			headers: { cookie: session.cookie },
		}),
	).toBe(404);
	// The API with the bearer token.
	expect(
		await request("/api/v1/openapi.json", {
			headers: { authorization: session.authorization },
		}),
	).toBe(200);
	// An unknown API path with canaries in the query and the body.
	expect(
		await request(`/api/v1/no-such-thing?${canaryQuery}`, {
			body: canaryBody,
			headers: {
				authorization: session.authorization,
				"content-type": "application/json",
			},
			method: "POST",
		}),
	).toBe(404);
	// SIGTERM ends with telemetryShutdown, which flushes every signal.
	exitCode = await server.stop();
}, 60_000);

afterAll(async () => {
	await server?.stop();
	await receiver?.close();
	await drop?.();
});

describe("telemetry from the production build", { timeout: 30_000 }, () => {
	it("exits 0 after SIGTERM", () => {
		expect(exitCode).toBe(0);
	});

	it("traces the page load and replaces query values", () => {
		const page = receiver
			.spans()
			.find(
				(span) =>
					span.kind === spanKindServer &&
					spanAttribute(span, "url.path") === "/no-such-page",
			);
		expect(page).toBeDefined();
		expect(spanAttribute(page as OtlpSpan, "url.query")).toBe(
			"card=REDACTED&email=REDACTED",
		);
	});

	it("exports pino records as OTLP logs and pg client metrics (V16)", () => {
		const signals = telemetrySignals(server, receiver);
		expect(signals.logs).toContain("Server listening");
		expect(signals.metrics).toMatch(/"name":"db\.client\.[a-z._]+"/);
	});

	it.each(
		Object.entries({
			"access cookie": () => session.accessCookie,
			"bearer token": () => session.token,
			"card number": () => canaries.card,
			"client secret": () => clientSecret,
			email: () => canaries.email,
			"health term": () => canaries.health,
		}),
	)("never exports or prints the %s", (_name, value) => {
		expect(signalsLeaking(telemetrySignals(server, receiver), value())).toEqual(
			[],
		);
	});

	it("never sends the client secret in a response body", () => {
		expect(responseBodies).toHaveLength(4);
		for (const body of responseBodies) {
			expect(body).not.toContain(clientSecret);
		}
	});
});
