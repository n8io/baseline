import { STATUS_CODES } from "node:http";
import { z } from "@hono/zod-openapi";
import { trace } from "@opentelemetry/api";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Maps every error `type` of a domain to the HTTP status it answers with. */
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

export const httpProblemHeaders: {
	"Content-Type": "application/problem+json";
} = {
	"Content-Type": "application/problem+json",
};

const traceIdActive = (): string | undefined => {
	const spanContext = trace.getActiveSpan()?.spanContext();
	return spanContext !== undefined && trace.isSpanContextValid(spanContext)
		? spanContext.traceId
		: undefined;
};

export const httpProblemCreate = (
	status: number,
	code: string,
): HttpProblem => {
	const traceId = traceIdActive();
	return {
		status,
		title: STATUS_CODES[status] ?? "Unknown",
		code,
		...(traceId === undefined ? {} : { traceId }),
	};
};

/** The problem body for a domain error: `code` is the error's `type` tag. */
export const httpErrorBodyCreate = (
	error: { type: string },
	status: ContentfulStatusCode,
): HttpProblem => httpProblemCreate(status, error.type);

export const httpProblemSchemaCreate = (
	codes: [string, ...string[]],
): z.ZodType<HttpProblem> =>
	z.object({
		status: z.number().int(),
		title: z.string(),
		code: z.enum(codes),
		traceId: z.string().optional(),
		errors: z
			.array(z.object({ pointer: z.string(), detail: z.string() }))
			.optional(),
		// Zod types an optional key as `?: T | undefined`; HttpProblem leaves out `undefined`.
	}) as z.ZodType<HttpProblem>;
