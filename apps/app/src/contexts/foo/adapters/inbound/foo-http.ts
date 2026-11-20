import type { z } from "@hono/zod-openapi";
import { httpErrorBodyCreate, httpProblemHeaders } from "@n8io/baseline-http";
import type { Context } from "hono";
import type { FooError } from "../../domain/errors.ts";
import { fooErrorStatus } from "../../foo-error-status.ts";

// The routes' shared HTTP parts. A route answers a Use case's error with its problem body; the
// status narrows to the error's own, so the route's declared responses still type-check.
export const fooHttpErrorAnswer = <T extends FooError["type"]>(
	c: Context,
	error: { type: T },
) => {
	const status: (typeof fooErrorStatus)[T] = fooErrorStatus[error.type];
	return c.json(httpErrorBodyCreate(error, status), status, httpProblemHeaders);
};

// A JSON response or body in a route's OpenAPI definition.
export const fooHttpJson = <S extends z.ZodType>(
	schema: S,
	description: string,
) => ({
	content: { "application/json": { schema } },
	description,
});
