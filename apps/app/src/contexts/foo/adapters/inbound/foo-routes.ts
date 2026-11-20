import { createRoute, z } from "@hono/zod-openapi";
import { authnActorRequire } from "@n8io/baseline-authn";
import {
	type HttpErrorStatus,
	httpErrorResponsesCreate,
	httpRouterCreate,
} from "@n8io/baseline-http";
import type { FooUseCases } from "../../application/foo-use-cases.ts";
import type { FooError } from "../../domain/errors.ts";
import { Foo, FooListInput } from "../../domain/foo.ts";
import { fooErrorStatus } from "../../foo-error-status.ts";
import { fooHttpErrorAnswer, fooHttpJson } from "./foo-http.ts";

// The route table is the API's view of the context's statuses; it fails type-checking if the two disagree.
fooErrorStatus satisfies HttpErrorStatus<FooError>;

// The API's own schemas: Aggregate schemas carry no OpenAPI metadata. Dates go out as RFC 3339 UTC strings.
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
// The document says boolean, which is how the SDK sends one (`?count=true`).
const queryBoolean = z
	.stringbool({ falsy: ["false"], truthy: ["true"] })
	.default(false)
	.openapi({ default: false, type: "boolean" });
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

// Each operation is named after the Use case it calls and tagged with its Aggregate; SDK methods
// and CLI commands take their names from both and their help from the summary (docs/agents/api.md).
const fooCreateRoute = createRoute({
	operationId: "fooCreate",
	summary: "Create one foo",
	tags: ["foo"],
	method: "post",
	path: "/",
	request: {
		body: {
			content: { "application/json": { schema: FooCreateBody } },
			// Without it, a request with no body or Content-Type skips validation.
			required: true,
		},
	},
	responses: {
		201: fooHttpJson(FooResponse, "Created"),
		...httpErrorResponsesCreate(fooErrorStatus, ["FooNameTaken"]),
	},
});

const fooListRoute = createRoute({
	operationId: "fooList",
	summary: "List foos, one page at a time",
	tags: ["foo"],
	method: "get",
	path: "/",
	request: { query: FooListQuery },
	responses: { 200: fooHttpJson(FooListResponse, "A page of foos") },
});

const fooGetRoute = createRoute({
	operationId: "fooGet",
	summary: "Get one foo",
	tags: ["foo"],
	method: "get",
	path: "/{fooId}",
	request: { params: FooParams },
	responses: {
		200: fooHttpJson(FooResponse, "The foo"),
		...httpErrorResponsesCreate(fooErrorStatus, ["FooNotFound"]),
	},
});

const fooUpdateRoute = createRoute({
	operationId: "fooUpdate",
	summary: "Update one foo",
	tags: ["foo"],
	method: "patch",
	path: "/{fooId}",
	request: {
		body: {
			content: { "application/json": { schema: FooUpdateBody } },
			// Without it, a request with no body or Content-Type skips validation.
			required: true,
		},
		params: FooParams,
	},
	responses: {
		200: fooHttpJson(FooResponse, "Updated"),
		...httpErrorResponsesCreate(fooErrorStatus, [
			"FooNotFound",
			"FooNameTaken",
			"FooForbidden",
		]),
	},
});

const fooDeleteRoute = createRoute({
	operationId: "fooDelete",
	summary: "Delete one foo",
	tags: ["foo"],
	method: "delete",
	path: "/{fooId}",
	request: { params: FooParams },
	responses: {
		204: { description: "Deleted" },
		...httpErrorResponsesCreate(fooErrorStatus, [
			"FooNotFound",
			"FooForbidden",
		]),
	},
});

// Mounted at /api/v1/foos. Each route calls exactly one Use case.
export const fooRoutesCreate = (u: FooUseCases) =>
	httpRouterCreate()
		.openapi(fooCreateRoute, async (c) => {
			const result = await u.fooCreate(
				authnActorRequire(c),
				c.req.valid("json"),
			);
			if (!result.ok) return fooHttpErrorAnswer(c, result.error);
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
			if (!result.ok) return fooHttpErrorAnswer(c, result.error);
			return c.json(fooResponse(result.value), 200);
		})
		.openapi(fooUpdateRoute, async (c) => {
			const result = await u.fooUpdate(authnActorRequire(c), {
				...c.req.valid("json"),
				...c.req.valid("param"),
			});
			if (!result.ok) return fooHttpErrorAnswer(c, result.error);
			return c.json(fooResponse(result.value), 200);
		})
		.openapi(fooDeleteRoute, async (c) => {
			const result = await u.fooDelete(
				authnActorRequire(c),
				c.req.valid("param"),
			);
			if (!result.ok) return fooHttpErrorAnswer(c, result.error);
			return c.body(null, 204);
		});
