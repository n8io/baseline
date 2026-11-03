import { STATUS_CODES } from "node:http";
import { z } from "@hono/zod-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Maps every error `type` of a domain to the HTTP status it answers with. */
export type HttpErrorStatus<E extends { type: string }> = Record<
	E["type"],
	ContentfulStatusCode
>;

/** An RFC 9457 problem details body. Never carries text from an error message or from input. */
export type HttpProblem = {
	status: number;
	title: string;
	code: string;
	errors?: { pointer: string; detail: string }[];
};

export const httpProblemHeaders: {
	"Content-Type": "application/problem+json";
} = {
	"Content-Type": "application/problem+json",
};

export const httpProblemCreate = (
	status: number,
	code: string,
): HttpProblem => ({
	status,
	title: STATUS_CODES[status] ?? "Unknown",
	code,
});

/** The problem body for a domain error: `code` is the error's `type` tag. */
export const httpErrorBody = (
	error: { type: string },
	status: ContentfulStatusCode,
): HttpProblem => httpProblemCreate(status, error.type);

export const httpProblemSchema = (
	codes: [string, ...string[]],
): z.ZodType<HttpProblem> =>
	z.object({
		status: z.number().int(),
		title: z.string(),
		code: z.enum(codes),
		errors: z
			.array(z.object({ pointer: z.string(), detail: z.string() }))
			.optional(),
		// Zod types an optional key as `?: T | undefined`; HttpProblem leaves out `undefined`.
	}) as z.ZodType<HttpProblem>;
