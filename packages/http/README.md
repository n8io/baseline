# @n8io/baseline-http

**Every API error answers in one shape**: RFC 9457 problem bodies with the request's trace id, OpenAPI error responses checked against your Use cases' errors, and secure defaults for the Hono app around them.

```sh
pnpm add @n8io/baseline-http
```

```json
{
	"status": 404,
	"title": "Not Found",
	"code": "FooNotFound",
	"traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

## Guarantees

| You get                                       | How                                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One error shape**                           | Validation failures, business errors, refused requests and crashes all answer `application/problem+json`: `status`, `title`, `code`, `traceId`.                     |
| **No leaked text**                            | A body never carries a thrown error's message or the caller's input; validation details name only what the schema expects. A crash is a logged 500 `InternalError`. |
| **Errors you can find**                       | `traceId` is the request's trace, so a caller's report leads straight to its spans and logs.                                                                        |
| **Pointers to bad input**                     | A failed request validation is 400 `ValidationFailed` with one JSON Pointer per issue.                                                                              |
| **Docs that match the code**                  | `httpErrorResponsesCreate` declares a route's error responses from the same table it answers with; a business error missing from the table fails type-checking.     |
| **New error codes are not breaking**          | Codes are an `x-extensible-enum`, so the API diff accepts a new code on a status a route already declares.                                                          |
| **Secure headers and a nonce CSP**            | HSTS, `nosniff`, `Referrer-Policy` and an enforced CSP whose `script-src` takes a fresh nonce per request.                                                          |
| **CSRF refused on cookie routes**             | A cross-site form, multipart or text POST answers 403; JSON and bearer requests pass. Works behind a TLS proxy.                                                     |
| **No 502s from stale keep-alive connections** | Idle connections stay open 65 s, longer than a balancer's usual 60 s.                                                                                               |
| **A close that finishes requests**            | `httpServerClose` stops accepting connections and resolves once open requests finish.                                                                               |
| **Spans named after routes**                  | `POST /api/v1/foos`, not `POST`.                                                                                                                                    |

## Example

Wire the app once:

```ts
import {
	httpCsrf,
	httpErrorHandle,
	httpNotFoundHandle,
	httpRouterCreate,
	httpSecureHeaders,
} from "@n8io/baseline-http";
import { except } from "hono/combine";

export const app = httpRouterCreate();
app.onError(httpErrorHandle);
app.use(httpSecureHeaders);
app.use("*", except(["/api/*"], httpCsrf));
app.route("/api/v1/foos", fooRoutesCreate(useCases.fooUseCases));
app.all("/api/*", httpNotFoundHandle);
```

Add `app.use(httpRouteName)` to name spans after routes. On the `node:http` server, call `httpServerKeepAlive(server)` once, and `await httpServerClose(server)` on shutdown.

A route maps each business error to a status once, and its docs and answers both read that map: see "A whole route".

Test a route with Hono's `app.request()`: the problem body comes back as JSON, with no server and no mocks.

## Reference

<details><summary><b>Exports</b></summary>

| Export                                                         | Does                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `httpRouterCreate()`                                           | An `OpenAPIHono` router whose request validation answers 400 `ValidationFailed` with a problem body.                                                                                                                                                                                      |
| `httpErrorHandle`                                              | `app.onError`. A thrown error with a 4xx `httpStatus` and a `type` (authn's 401s) answers that status and code; a Hono 4xx `HTTPException` answers its status (400 `ValidationFailed`, 413 `PayloadTooLarge`, 415 `UnsupportedMediaType`); anything else is a logged 500 `InternalError`. |
| `httpNotFoundHandle`                                           | The API's not-found route: a JSON 404 `NotFound`, never HTML.                                                                                                                                                                                                                             |
| `httpErrorBodyCreate(error, status)`                           | The problem body for a business error; `code` is the error's `type`.                                                                                                                                                                                                                      |
| `httpProblemHeaders`                                           | `Content-Type: application/problem+json`.                                                                                                                                                                                                                                                 |
| `HttpProblem`                                                  | The problem body type: `status`, `title`, `code`, optional `traceId` and `errors` (`{ pointer, detail }[]`). `traceId` is absent only when nothing traces the request.                                                                                                                    |
| `HttpErrorStatus<E>`                                           | A bounded context's map from error `type` to status; a missing type fails type-checking.                                                                                                                                                                                                  |
| `httpErrorResponsesCreate(table, types)`, `HttpErrorResponses` | A route's OpenAPI error responses: one `application/problem+json` entry per status, listing the error types that answer with it, typed so the handler may return those statuses.                                                                                                          |
| `httpRouteName`                                                | Middleware that names the HTTP server span after the route that answered and sets `http.route`. Catch-all routes (a pattern ending in `*`) keep the name something else gave them.                                                                                                        |
| `httpCsrf`                                                     | Hono's `csrf()` for cookie-authenticated routes. A form, multipart or text POST answers 403 unless `Sec-Fetch-Site` is `same-origin` or `Origin` is the Server's public origin, which is https when `x-forwarded-proto` says so.                                                          |
| `httpSecureHeaders`                                            | Hono's secure headers plus an enforced CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`) whose `script-src` takes a fresh nonce per request: `c.get("secureHeadersNonce")`.                                                                    |
| `httpServerClose(server)`                                      | Stops accepting connections, closes idle keep-alive sockets every 100 ms, and resolves once every open request finishes. It never cuts a running request off.                                                                                                                             |
| `httpServerKeepAlive(server)`                                  | Keeps idle connections open for 65 s (headers timeout 66 s), so a load balancer with the usual 60 s idle timeout never reuses a connection the server has closed (a 502). Keep the balancer's idle timeout under 65 s.                                                                    |
</details>

<details><summary><b>A whole route</b></summary>

```ts
import { createRoute } from "@hono/zod-openapi";
import {
	type HttpErrorStatus,
	httpErrorBodyCreate,
	httpErrorResponsesCreate,
	httpProblemHeaders,
	httpRouterCreate,
} from "@n8io/baseline-http";

const fooErrorStatus = {
	FooNotFound: 404,
} as const satisfies HttpErrorStatus<FooError>;

const fooGetRoute = createRoute({
	method: "get",
	path: "/{fooId}",
	request: { params: FooParams },
	responses: {
		200: {
			content: { "application/json": { schema: FooResponse } },
			description: "The foo",
		},
		...httpErrorResponsesCreate(fooErrorStatus, ["FooNotFound"]),
	},
});

export const fooRoutesCreate = (u: FooUseCases) =>
	httpRouterCreate().openapi(fooGetRoute, async (c) => {
		const result = await u.fooGet(c.req.valid("param"));
		if (!result.ok) {
			const status = fooErrorStatus[result.error.type];
			return c.json(
				httpErrorBodyCreate(result.error, status),
				status,
				httpProblemHeaders,
			);
		}
		return c.json(fooResponse(result.value), 200);
	});
```
</details>

<details><summary><b>A validation failure</b></summary>

```json
{
	"status": 400,
	"title": "Bad Request",
	"code": "ValidationFailed",
	"traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
	"errors": [
		{
			"pointer": "/name",
			"detail": "Too small: expected string to have >=1 characters"
		}
	]
}
```

Each `pointer` is an RFC 6901 JSON Pointer into the request part that failed. Zod's "Unrecognized keys" message would repeat the caller's key names, so it reads `Unrecognized key`.
</details>

**Needs** `hono`, `@hono/zod-openapi`, `zod` and `@opentelemetry/api` as peers. No env.
