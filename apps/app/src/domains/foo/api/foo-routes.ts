import { createRoute, z } from "@hono/zod-openapi";
import { authnActorRequire } from "@n8io/baseline-authn";
import {
	httpErrorBody,
	httpErrorResponses,
	httpProblemHeaders,
	httpRouterCreate,
} from "@n8io/baseline-http";
import { Foo, FooListInput, type FooUseCases } from "../index.ts";
import { fooErrorStatus } from "./foo-error-status.ts";

// The API's own schemas: models carry no OpenAPI metadata. Dates go out as RFC 3339 UTC strings.
export const FooResponse = z
	.object({
		id: Foo.shape.id,
		name: z.string(),
		createdBy: z.string(),
		createdAt: z.iso.datetime(),
		updatedAt: z.iso.datetime(),
		archivedAt: z.iso.datetime().nullable(),
	})
	.openapi("FooResponse");

export const FooListResponse = z
	.object({
		items: z.array(FooResponse),
		nextCursor: z.string().nullable(),
		total: z.number().int().optional(),
	})
	.openapi("FooListResponse");

export const FooCreateBody = z
	.strictObject({ name: Foo.shape.name })
	.openapi("FooCreateBody");

export const FooUpdateBody = z
	.strictObject({ name: Foo.shape.name })
	.openapi("FooUpdateBody");

// Query strings arrive as text: numbers are coerced, and booleans accept only "true" or "false".
const queryBoolean = z
	.stringbool({ falsy: ["false"], truthy: ["true"] })
	.default(false);
export const FooListQuery = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	cursor: FooListInput.shape.cursor,
	count: queryBoolean,
	archived: queryBoolean,
	sort: FooListInput.shape.sort,
});

const FooParams = z.object({ fooId: Foo.shape.id });

const fooResponse = (foo: Foo): z.infer<typeof FooResponse> => ({
	id: foo.id,
	name: foo.name,
	createdBy: foo.createdBy,
	createdAt: foo.createdAt.toISOString(),
	updatedAt: foo.updatedAt.toISOString(),
	archivedAt: foo.archivedAt?.toISOString() ?? null,
});

const json = <S extends z.ZodType>(schema: S, description: string) => ({
	content: { "application/json": { schema } },
	description,
});

const fooCreateRoute = createRoute({
	method: "post",
	path: "/",
	request: {
		body: { content: { "application/json": { schema: FooCreateBody } } },
	},
	responses: {
		201: json(FooResponse, "Created"),
		...httpErrorResponses(fooErrorStatus, ["FooNameTaken"]),
	},
});

const fooListRoute = createRoute({
	method: "get",
	path: "/",
	request: { query: FooListQuery },
	responses: { 200: json(FooListResponse, "A page of foos") },
});

const fooGetRoute = createRoute({
	method: "get",
	path: "/{fooId}",
	request: { params: FooParams },
	responses: {
		200: json(FooResponse, "The foo"),
		...httpErrorResponses(fooErrorStatus, ["FooNotFound"]),
	},
});

const fooUpdateRoute = createRoute({
	method: "patch",
	path: "/{fooId}",
	request: {
		body: { content: { "application/json": { schema: FooUpdateBody } } },
		params: FooParams,
	},
	responses: {
		200: json(FooResponse, "Updated"),
		...httpErrorResponses(fooErrorStatus, [
			"FooNotFound",
			"FooNameTaken",
			"FooForbidden",
		]),
	},
});

const fooDeleteRoute = createRoute({
	method: "delete",
	path: "/{fooId}",
	request: { params: FooParams },
	responses: {
		204: { description: "Deleted" },
		...httpErrorResponses(fooErrorStatus, ["FooNotFound", "FooForbidden"]),
	},
});

// Mounted at /api/v1/foos. Each route calls exactly one use case.
export const fooRoutes = (u: FooUseCases) =>
	httpRouterCreate()
		.openapi(fooCreateRoute, async (c) => {
			const result = await u.fooCreate(
				authnActorRequire(c),
				c.req.valid("json"),
			);
			if (!result.ok) {
				const status = fooErrorStatus[result.error.type];
				return c.json(
					httpErrorBody(result.error, status),
					status,
					httpProblemHeaders,
				);
			}
			return c.json(fooResponse(result.value), 201);
		})
		.openapi(fooListRoute, async (c) => {
			const result = await u.fooList(
				authnActorRequire(c),
				c.req.valid("query"),
			);
			// fooList has no expected errors; the branch stays so a new one fails type-checking.
			if (!result.ok) return result.error satisfies never;
			return c.json(
				{ ...result.value, items: result.value.items.map(fooResponse) },
				200,
			);
		})
		.openapi(fooGetRoute, async (c) => {
			const result = await u.fooGet(authnActorRequire(c), c.req.valid("param"));
			if (!result.ok) {
				const status = fooErrorStatus[result.error.type];
				return c.json(
					httpErrorBody(result.error, status),
					status,
					httpProblemHeaders,
				);
			}
			return c.json(fooResponse(result.value), 200);
		})
		.openapi(fooUpdateRoute, async (c) => {
			const result = await u.fooUpdate(authnActorRequire(c), {
				...c.req.valid("json"),
				...c.req.valid("param"),
			});
			if (!result.ok) {
				const status = fooErrorStatus[result.error.type];
				return c.json(
					httpErrorBody(result.error, status),
					status,
					httpProblemHeaders,
				);
			}
			return c.json(fooResponse(result.value), 200);
		})
		.openapi(fooDeleteRoute, async (c) => {
			const result = await u.fooDelete(
				authnActorRequire(c),
				c.req.valid("param"),
			);
			if (!result.ok) {
				const status = fooErrorStatus[result.error.type];
				return c.json(
					httpErrorBody(result.error, status),
					status,
					httpProblemHeaders,
				);
			}
			return c.body(null, 204);
		});
