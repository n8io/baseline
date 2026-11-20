import { STATUS_CODES } from "node:http";
import { z } from "@hono/zod-openapi";
import { trace } from "@opentelemetry/api";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Maps every error `type` of a bounded context to the HTTP status it answers with. */
export type HttpErrorStatus<E extends { type: string }> = Record<
	E["type"],
	ContentfulStatusCode
>;

/**
 * An RFC 9457 problem details body. Never carries text from an error message or from input.
 * `traceId` is the request's trace: a caller reports it, and it finds the request's spans and
 * logs (`trace_id`). It is absent only when nothing traces the request.
 */
export type HttpProblem = {
	status: number;
	title: string;
	code: string;
	traceId?: string;
	errors?: { pointer: string; detail: string }[];
};

/** The `Content-Type` of every problem body: `application/problem+json`. */
export const httpProblemHeaders: {
	"Content-Type": "application/problem+json";
} = {
	"Content-Type": "application/problem+json",
};

const httpTraceIdActive = (): string | undefined => {
	const spanContext = trace.getActiveSpan()?.spanContext();
	return spanContext !== undefined && trace.isSpanContextValid(spanContext)
		? spanContext.traceId
		: undefined;
};

// The problem body for `status` with `code`, carrying the active trace id when there is one, for an
// answer that is not a business error (validation, CSRF, not found). It takes `(status, code)`;
// `httpErrorBodyCreate` takes `(error, status)`. Private: only this Package's handlers use it.
export const httpProblemCreate = (
	status: number,
	code: string,
): HttpProblem => {
	const traceId = httpTraceIdActive();
	return {
		status,
		title: STATUS_CODES[status] ?? "Unknown",
		code,
		...(traceId === undefined ? {} : { traceId }),
	};
};

/**
 * The problem body for a business error: `code` is the error's `type` tag, `title` the status's
 * reason phrase. Use it in a handler that maps a bounded context's error to its status.
 */
export const httpErrorBodyCreate = (
	error: { type: string },
	status: ContentfulStatusCode,
): HttpProblem => httpProblemCreate(status, error.type);

/** The OpenAPI schema of a problem body whose `code` is one of `codes`. */
export const httpProblemSchemaCreate = (
	codes: [string, ...string[]],
): z.ZodType<HttpProblem> =>
	z.object({
		status: z.number().int(),
		title: z.string(),
		// `x-extensible-enum`, not `enum`: oasdiff treats a new value as a compatible change, so a
		// route can answer a new error code on a status it already declares.
		code: z.string().openapi({ "x-extensible-enum": codes }),
		traceId: z.string().optional(),
		errors: z
			.array(z.object({ pointer: z.string(), detail: z.string() }))
			.optional(),
		// Zod types an optional key as `?: T | undefined`; HttpProblem leaves out `undefined`.
	}) as z.ZodType<HttpProblem>;
