import type { RouteConfig } from "@hono/zod-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { httpProblemSchema } from "./http-problem.ts";

/**
 * Builds a route's OpenAPI error responses from its domain's status table: one entry per status,
 * listing the error types that answer with it.
 */
export const httpErrorResponses = <T extends string>(
	table: Record<T, ContentfulStatusCode>,
	types: NoInfer<T>[],
): RouteConfig["responses"] => {
	const byStatus = new Map<ContentfulStatusCode, [string, ...string[]]>();
	for (const type of types) {
		const status = table[type];
		const codes = byStatus.get(status);
		if (codes) codes.push(type);
		else byStatus.set(status, [type]);
	}
	const responses: RouteConfig["responses"] = {};
	for (const [status, codes] of byStatus) {
		responses[status] = {
			content: {
				"application/problem+json": { schema: httpProblemSchema(codes) },
			},
			description: codes.join(", "),
		};
	}
	return responses;
};
