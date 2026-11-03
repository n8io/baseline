import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import {
	type OtlpReceiver,
	type OtlpSpan,
	otlpEnv,
	otlpReceiverStart,
	type ProductionServer,
	productionServerStart,
	type SignedIn,
	signIn,
	spanAncestors,
	spanAttribute,
} from "./production-server.ts";

// Personal data a user might type: an email, a test card number and a health term.
const canaries = {
	card: "4111111111111111",
	email: "canary.person@example.com",
	health: "hypertension",
};
const fooName = `Canary ${canaries.email} ${canaries.card} ${canaries.health}`;
const clientSecret = `canary-client-secret-${randomUUID()}`;

const spanKindServer = 2;
const spanKindClient = 3;

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

const apiPost = (body: unknown) =>
	request("/api/v1/foos", {
		body: JSON.stringify(body),
		headers: {
			authorization: session.authorization,
			"content-type": "application/json",
		},
		method: "POST",
	});

// The whole journey runs once; each test then reads what it left behind.
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
	expect(await apiPost({ name: fooName })).toBe(201);
	// The repeat fails on the unique name: Postgres's 23505 detail now holds the canaries.
	expect(await apiPost({ name: fooName })).toBe(409);
	// An unknown key holding a canary fails validation.
	expect(await apiPost({ name: "Other", note: canaries.email })).toBe(400);
	expect(
		await request(`/foos?cursor=${encodeURIComponent(canaries.email)}`, {
			headers: { cookie: session.cookie },
		}),
	).toBe(200);
	expect(responseBodies.at(-1)).toContain(fooName);
	// SIGTERM ends with telemetryShutdown, which flushes every signal.
	exitCode = await server.stop();
}, 60_000);

afterAll(async () => {
	await server?.stop();
	await receiver?.close();
	await drop?.();
});

const signals = (): Record<string, string> => ({
	logs: (receiver.bodies["/v1/logs"] ?? []).join("\n"),
	metrics: (receiver.bodies["/v1/metrics"] ?? []).join("\n"),
	stderr: server.stderr(),
	stdout: server.stdout(),
	traces: (receiver.bodies["/v1/traces"] ?? []).join("\n"),
});

describe("telemetry from the production build", { timeout: 30_000 }, () => {
	it("exits 0 after SIGTERM", () => {
		expect(exitCode).toBe(0);
	});

	it("traces the HTTP server span to fooCreate to pg", () => {
		const spans = receiver.spans();
		const created = spans.find(
			(span) =>
				span.kind === spanKindServer &&
				span.name === "POST /api/v1/foos" &&
				spanAttribute(span, "http.response.status_code") === "201",
		);
		expect(created).toBeDefined();
		const useCase = spans.find(
			(span) =>
				span.name === "fooCreate" &&
				spanAncestors(span, spans).includes(created as OtlpSpan),
		);
		expect(useCase).toBeDefined();
		const queries = spans.filter(
			(span) =>
				span.kind === spanKindClient &&
				spanAttribute(span, "db.system.name") === "postgresql" &&
				spanAncestors(span, spans).includes(useCase as OtlpSpan),
		);
		expect(queries.length).toBeGreaterThan(0);
	});

	it("traces the page load and replaces query values", () => {
		const spans = receiver.spans();
		const list = spans.find(
			(span) =>
				span.kind === spanKindServer &&
				spanAttribute(span, "url.path") === "/foos",
		);
		expect(list).toBeDefined();
		expect(spanAttribute(list as OtlpSpan, "url.query")).toBe(
			"cursor=REDACTED",
		);
	});

	it("exports pino records as OTLP logs and pg client metrics (V16)", () => {
		expect(signals().logs).toContain("Server listening");
		expect(signals().metrics).toMatch(/"name":"db\.client\.[a-z._]+"/);
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
		for (const [signal, text] of Object.entries(signals())) {
			expect({ signal, leaked: text.includes(value()) }).toEqual({
				leaked: false,
				signal,
			});
		}
	});

	it("never sends the client secret in a response body", () => {
		expect(responseBodies).toHaveLength(4);
		for (const body of responseBodies) {
			expect(body).not.toContain(clientSecret);
		}
	});
});
