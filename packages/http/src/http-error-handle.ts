import { logger } from "@n8io/baseline-logger";
import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { httpProblemCreate, httpProblemHeaders } from "./http-problem.ts";

type HttpStatusError = { httpStatus: ContentfulStatusCode; type: string };

// Only shared packages throw errors that carry an `httpStatus` (authn's 401s).
const isHttpStatusError = (error: unknown): error is HttpStatusError => {
	if (typeof error !== "object" || error === null) return false;
	const { httpStatus, type } = error as {
		httpStatus?: unknown;
		type?: unknown;
	};
	return (
		typeof httpStatus === "number" &&
		httpStatus >= 400 &&
		httpStatus <= 499 &&
		typeof type === "string"
	);
};

/** `app.onError`: answers a thrown 4xx package error with its status, anything else with a logged 500. */
export const httpErrorHandle: ErrorHandler = (error, c) => {
	if (isHttpStatusError(error)) {
		return c.json(
			httpProblemCreate(error.httpStatus, error.type),
			error.httpStatus,
			httpProblemHeaders,
		);
	}
	// Hono's validator throws a 400 HTTPException for a body it cannot parse.
	if (error instanceof HTTPException && error.status === 400) {
		return c.json(
			httpProblemCreate(400, "ValidationFailed"),
			400,
			httpProblemHeaders,
		);
	}
	logger.error({ err: error, route: c.req.routePath, status: 500 });
	return c.json(
		httpProblemCreate(500, "InternalError"),
		500,
		httpProblemHeaders,
	);
};

/** Answers an unknown path with a JSON 404 `NotFound`, never HTML. */
export const httpNotFoundHandle: NotFoundHandler = (c) =>
	c.json(httpProblemCreate(404, "NotFound"), 404, httpProblemHeaders);
