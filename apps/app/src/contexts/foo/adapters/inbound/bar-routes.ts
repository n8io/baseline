import { createRoute, z } from "@hono/zod-openapi";
import { authnActorRequire } from "@n8io/baseline-authn";
import {
	httpErrorResponsesCreate,
	httpRouterCreate,
} from "@n8io/baseline-http";
import type { FooUseCases } from "../../application/foo-use-cases.ts";
import { Bar } from "../../domain/bar.ts";
import { Foo } from "../../domain/foo.ts";
import { fooErrorStatus } from "../../foo-error-status.ts";
import { fooHttpErrorAnswer, fooHttpJson } from "./foo-http.ts";

// The API's own schemas: Aggregate schemas carry no OpenAPI metadata. Dates go out as RFC 3339 UTC strings.
export const BarResponse = z
	.object({
		id: Bar.shape.id,
		fooId: Foo.shape.id,
		text: z.string(),
		createdBy: z.string(),
		createdAt: z.iso.datetime(),
	})
	.openapi("BarResponse");

export const BarListResponse = z
	.object({ items: z.array(BarResponse) })
	.openapi("BarListResponse");

export const BarCreateBody = z
	.strictObject({ text: Bar.shape.text })
	.openapi("BarCreateBody");

const BarParams = z.object({ fooId: Foo.shape.id });

const barResponse = (bar: Bar): z.infer<typeof BarResponse> => ({
	id: bar.id,
	fooId: bar.fooId,
	text: bar.text,
	createdBy: bar.createdBy,
	createdAt: bar.createdAt.toISOString(),
});

// A Bar is reached through its Foo: /api/v1/foos/{fooId}/bars.
const barCreateRoute = createRoute({
	operationId: "barCreate",
	summary: "Create one bar under a foo",
	tags: ["bar"],
	method: "post",
	path: "/{fooId}/bars",
	request: {
		body: {
			content: { "application/json": { schema: BarCreateBody } },
			// Without it, a request with no body or Content-Type skips validation.
			required: true,
		},
		params: BarParams,
	},
	responses: {
		201: fooHttpJson(BarResponse, "Created"),
		...httpErrorResponsesCreate(fooErrorStatus, [
			"FooNotFound",
			"FooForbidden",
		]),
	},
});

const barListRoute = createRoute({
	operationId: "barList",
	summary: "List one foo's bars, oldest first",
	tags: ["bar"],
	method: "get",
	path: "/{fooId}/bars",
	request: { params: BarParams },
	responses: {
		200: fooHttpJson(BarListResponse, "The foo's bars, oldest first"),
		...httpErrorResponsesCreate(fooErrorStatus, ["FooNotFound"]),
	},
});

// Mounted at /api/v1/foos beside fooRoutesCreate. Each route calls exactly one Use case.
export const barRoutesCreate = (u: FooUseCases) =>
	httpRouterCreate()
		.openapi(barCreateRoute, async (c) => {
			const result = await u.barCreate(authnActorRequire(c), {
				...c.req.valid("json"),
				...c.req.valid("param"),
			});
			if (!result.ok) return fooHttpErrorAnswer(c, result.error);
			return c.json(barResponse(result.value), 201);
		})
		.openapi(barListRoute, async (c) => {
			const result = await u.barList(
				authnActorRequire(c),
				c.req.valid("param"),
			);
			if (!result.ok) return fooHttpErrorAnswer(c, result.error);
			return c.json({ items: result.value.map(barResponse) }, 200);
		});
