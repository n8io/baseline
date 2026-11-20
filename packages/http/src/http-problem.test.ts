import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import {
	type HttpErrorStatus,
	httpErrorBodyCreate,
	httpErrorResponsesCreate,
	httpProblemHeaders,
} from "./index.ts";

type FooError =
	| { type: "FooNotFound" }
	| { type: "FooNameTaken" }
	| { type: "FooForbidden" }
	| { type: "FooArchived" };
const fooErrorStatus = {
	FooArchived: 409,
	FooForbidden: 403,
	FooNameTaken: 409,
	FooNotFound: 404,
} as const satisfies HttpErrorStatus<FooError>;

const documentCreate = (types: (keyof typeof fooErrorStatus)[]) =>
	new OpenAPIHono()
		.openapi(
			createRoute({
				method: "post",
				path: "/foos",
				responses: {
					201: { description: "Created" },
					...httpErrorResponsesCreate(fooErrorStatus, types),
				},
			}),
			(c) => c.body(null, 201),
		)
		.getOpenAPI31Document({
			info: { title: "test", version: "1" },
			openapi: "3.1.0",
		});

const oasdiffFound = spawnSync("oasdiff", ["--version"]).status === 0;

/** Runs `oasdiff breaking --fail-on ERR`; returns its exit code and output. */
const oasdiffRun = (base: unknown, revision: unknown) => {
	const dir = mkdtempSync(join(tmpdir(), "oasdiff-"));
	writeFileSync(join(dir, "base.json"), JSON.stringify(base));
	writeFileSync(join(dir, "revision.json"), JSON.stringify(revision));
	const result = spawnSync(
		"oasdiff",
		[
			"breaking",
			join(dir, "base.json"),
			join(dir, "revision.json"),
			"--fail-on",
			"ERR",
		],
		{ encoding: "utf8" },
	);
	return { output: result.stdout + result.stderr, status: result.status };
};

describe("an extensible error code", () => {
	it("documents `code` as a string whose known values are x-extensible-enum", () => {
		const conflict = documentCreate(["FooNameTaken"]).paths?.["/foos"]?.post
			?.responses?.["409"];

		expect(conflict).toMatchObject({
			content: {
				"application/problem+json": {
					schema: {
						properties: {
							code: { "x-extensible-enum": ["FooNameTaken"], type: "string" },
						},
					},
				},
			},
		});
	});

	// Run where the oasdiff binary is on PATH (CI's `check` job puts it there; the Package's own
	// job does not, so these two run locally and wherever it is installed).
	it.skipIf(!oasdiffFound)(
		"lets a route answer one more code on a status it already declares",
		() => {
			const result = oasdiffRun(
				documentCreate(["FooNameTaken"]),
				documentCreate(["FooNameTaken", "FooArchived"]),
			);

			expect(result.output).toContain("No breaking changes");
			expect(result.status).toBe(0);
		},
	);

	it.skipIf(!oasdiffFound)(
		"reports the one-time switch from enum as breaking",
		() => {
			const base = JSON.parse(JSON.stringify(documentCreate(["FooNameTaken"])));
			const code =
				base.paths["/foos"].post.responses["409"].content[
					"application/problem+json"
				].schema.properties.code;
			code.enum = code["x-extensible-enum"];
			delete code["x-extensible-enum"];

			const result = oasdiffRun(base, documentCreate(["FooNameTaken"]));

			// Projects older than app@8.1.0 saw this as breaking.
			expect(result.output).toContain("response-property-became-not-enum");
			expect(result.status).toBe(1);
		},
	);
});

describe("httpErrorBodyCreate", () => {
	it("returns status, the reason phrase as title and the error's type as code, never its message", () => {
		const error = Object.assign(new Error("canary@example.com is taken"), {
			type: "FooNameTaken",
		});

		expect(httpErrorBodyCreate(error, 409)).toStrictEqual({
			code: "FooNameTaken",
			status: 409,
			title: "Conflict",
		});
		expect(httpProblemHeaders).toStrictEqual({
			"Content-Type": "application/problem+json",
		});
	});
});
