import { STATUS_CODES } from "node:http";
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

// Hono and its middleware throw 4xx HTTPExceptions for requests they refuse: 400 for a body
// that is not JSON, 415 for a wrong Content-Type, 413 for a body over `bodyLimit`.
const isHttpException4xx = (
	error: unknown,
): error is HTTPException & { status: ContentfulStatusCode } =>
	error instanceof HTTPException && error.status >= 400 && error.status <= 499;

// 400 is ValidationFailed; any other status's code is its reason phrase in PascalCase
// (415 UnsupportedMediaType, 413 PayloadTooLarge).
const httpExceptionCode = (status: number): string =>
	status === 400
		? "ValidationFailed"
		: (STATUS_CODES[status] ?? "Client Error")
				.replaceAll("'", "")
				.split(/[^A-Za-z]+/)
				.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
				.join("");

/** `app.onError`: answers a thrown 4xx package error or Hono HTTPException with its status, anything else with a logged 500. */
export const httpErrorHandle: ErrorHandler = (error, c) => {
	if (isHttpStatusError(error)) {
		return c.json(
			httpProblemCreate(error.httpStatus, error.type),
			error.httpStatus,
			httpProblemHeaders,
		);
	}
	if (isHttpException4xx(error)) {
		return c.json(
			httpProblemCreate(error.status, httpExceptionCode(error.status)),
			error.status,
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
