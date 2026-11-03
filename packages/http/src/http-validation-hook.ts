import type { Hook } from "@hono/zod-openapi";
import type { Env } from "hono";
import type { z } from "zod";
import {
	type HttpProblem,
	httpProblemCreate,
	httpProblemHeaders,
} from "./http-problem.ts";

type HttpProblemError = NonNullable<HttpProblem["errors"]>[number];

// RFC 6901: "~" becomes "~0" and "/" becomes "~1" inside a segment.
const pointerCreate = (path: readonly PropertyKey[]): string =>
	path
		.map(
			(segment) =>
				`/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`,
		)
		.join("");

const problemErrorCreate = (issue: z.core.$ZodIssue): HttpProblemError => ({
	pointer: pointerCreate(issue.path),
	// Zod's "Unrecognized keys" message repeats the caller's key names; every other default message
	// names only the schema's expectations.
	detail:
		issue.code === "unrecognized_keys" ? "Unrecognized key" : issue.message,
});

/** Answers a failed request validation with 400 `ValidationFailed` and one JSON Pointer per issue. */
export const httpValidationHook: Hook<
	unknown,
	Env,
	string,
	Response | undefined
> = (result, c) => {
	if (result.success) return undefined;
	const body: HttpProblem = {
		...httpProblemCreate(400, "ValidationFailed"),
		errors: result.error.issues.map(problemErrorCreate),
	};
	return c.json(body, 400, httpProblemHeaders);
};
