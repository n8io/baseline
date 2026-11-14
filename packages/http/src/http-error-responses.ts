import type { z } from "@hono/zod-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type HttpProblem, httpProblemSchemaCreate } from "./http-problem.ts";

/** One problem+json response per status, typed so route handlers may return those statuses. */
export type HttpErrorResponses<S extends ContentfulStatusCode> = {
	[Status in S]: {
		content: {
			"application/problem+json": { schema: z.ZodType<HttpProblem> };
		};
		description: string;
	};
};

/**
 * Builds a route's OpenAPI error responses from its domain's status table: one entry per status,
 * listing the error types that answer with it.
 */
export const httpErrorResponsesCreate = <
	const Table extends Record<string, ContentfulStatusCode>,
	T extends keyof Table & string,
>(
	table: Table,
	types: readonly T[],
): HttpErrorResponses<Table[T]> => {
	const byStatus = new Map<ContentfulStatusCode, [string, ...string[]]>();
	for (const type of types) {
		// `types` holds only keys of `table`.
		const status = table[type] as ContentfulStatusCode;
		const codes = byStatus.get(status);
		if (codes) codes.push(type);
		else byStatus.set(status, [type]);
	}
	const responses: Partial<Record<ContentfulStatusCode, unknown>> = {};
	for (const [status, codes] of byStatus) {
		responses[status] = {
			content: {
				"application/problem+json": { schema: httpProblemSchemaCreate(codes) },
			},
			description: codes.join(", "),
		};
	}
	return responses as HttpErrorResponses<Table[T]>;
};
