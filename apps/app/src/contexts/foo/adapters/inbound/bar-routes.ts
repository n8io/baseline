import { createRoute, z } from "@hono/zod-openapi";
import { authnActorRequire } from "@n8io/baseline-authn";
import {
	httpErrorBodyCreate,
	httpErrorResponsesCreate,
	httpProblemHeaders,
	httpRouterCreate,
} from "@n8io/baseline-http";
import type { FooUseCases } from "../../application/foo-use-cases.ts";
import { Bar } from "../../domain/bar.ts";
import { Foo } from "../../domain/foo.ts";
import { fooErrorStatus } from "../../foo-error-status.ts";

// The API's own schemas: models carry no OpenAPI metadata. Dates go out as RFC 3339 UTC strings.
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

const json = <S extends z.ZodType>(schema: S, description: string) => ({
	content: { "application/json": { schema } },
	description,
});

// A Bar is reached through its Foo: /api/v1/foos/{fooId}/bars.
const barCreateRoute = createRoute({
	operationId: "barCreate",
	summary: "Create one bar under its foo",
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
		201: json(BarResponse, "Created"),
		...httpErrorResponsesCreate(fooErrorStatus, [
			"FooNotFound",
			"FooForbidden",
		]),
	},
});

const barListRoute = createRoute({
	operationId: "barList",
	summary: "List a foo's bars, one page at a time",
	tags: ["bar"],
	method: "get",
	path: "/{fooId}/bars",
	request: { params: BarParams },
	responses: {
		200: json(BarListResponse, "The foo's bars, oldest first"),
		...httpErrorResponsesCreate(fooErrorStatus, ["FooNotFound"]),
	},
});

// Mounted at /api/v1/foos beside fooRoutesCreate. Each route calls exactly one use case.
export const barRoutesCreate = (u: FooUseCases) =>
	httpRouterCreate()
		.openapi(barCreateRoute, async (c) => {
			const result = await u.barCreate(authnActorRequire(c), {
				...c.req.valid("json"),
				...c.req.valid("param"),
			});
			if (!result.ok) {
				const status = fooErrorStatus[result.error.type];
				return c.json(
					httpErrorBodyCreate(result.error, status),
					status,
					httpProblemHeaders,
				);
			}
			return c.json(barResponse(result.value), 201);
		})
		.openapi(barListRoute, async (c) => {
			const result = await u.barList(
				authnActorRequire(c),
				c.req.valid("param"),
			);
			if (!result.ok) {
				const status = fooErrorStatus[result.error.type];
				return c.json(
					httpErrorBodyCreate(result.error, status),
					status,
					httpProblemHeaders,
				);
			}
			return c.json({ items: result.value.map(barResponse) }, 200);
		});
