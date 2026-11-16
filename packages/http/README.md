# @n8io/baseline-http

Hono helpers for the API: RFC 9457 problem bodies, OpenAPI error responses, secure headers and graceful close.

```sh
pnpm add @n8io/baseline-http
```

## Exports

- `httpRouterCreate()`: an `OpenAPIHono` router whose request validation answers 400 with a problem body.
- `httpErrorHandle`, `httpNotFoundHandle`: `app.onError` and the API's not-found route; both answer `application/problem+json`, never error text.
- `httpErrorBodyCreate(error, status)`, `httpProblemHeaders`: the problem body and headers for a domain error. The body carries the request's `traceId`.
- `HttpErrorStatus<E>`: a domain's map from error `type` to status; a missing type fails type-checking.
- `httpErrorResponsesCreate(table, types)`, `HttpErrorResponses`: a route's OpenAPI error responses from that map.
- `HttpProblem`: the problem body type.
- `httpRouteName`: middleware that names the HTTP server span after the route that answered.
- `httpCsrf`: Hono's `csrf()` for cookie-authenticated routes. A form, multipart or text POST answers 403 unless `Sec-Fetch-Site` is `same-origin` or `Origin` is the server's public origin, which is https when `x-forwarded-proto` says so.
- `httpSecureHeaders`: Hono's secure headers plus an enforced CSP whose `script-src` takes a fresh nonce per request (`c.get("secureHeadersNonce")`).
- `httpServerClose(server)`: stops accepting connections and resolves once open requests finish.
- `httpServerKeepAlive(server)`: keeps idle connections open for 65 s, so a load balancer with the usual 60 s idle timeout never reuses a connection the server has closed (a 502). Keep the balancer's idle timeout under 65 s.

## Example

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

## Needs

Peers: `hono`, `@hono/zod-openapi`, `zod` and `@opentelemetry/api`. No env.
