# @n8io/baseline-authn

OIDC sign-in for pages, JWT verification for the API, and the Actor both hand to use cases.

```sh
pnpm add @n8io/baseline-authn
```

## Exports

- `authnCreate(options)`: discovers the OIDC provider, or starts the memory issuer when `issuerUrl` is `memory://`. Returns the `Authn` the other functions take.
- `authnMiddleware(authn, { source })`: sets `c.var.actor` from a `"bearer"` token (API) or the `"cookie"` session (pages). A missing token stays anonymous; an invalid one is a 401 or a redirect to sign-in.
- `authnRoutes(authn)`: `/sign-in`, `/callback`, `/refresh` and `/sign-out`, mounted at `/auth`.
- `authnActorRequire(c | args)`: the signed-in Actor of an API request (else 401) or of a loader or action (else a redirect to sign-in).
- `Actor`: `{ id, kind: "user" | "client", scopes }`, as a type and a Zod schema.
- `actorContext`, `authnExpiryContext`: React Router contexts the load context fills.
- `AuthnRequiredError`: the 401 `authnActorRequire` throws.
- `authnMemoryTokenCreate(authn, actor)`: a bearer token from the memory issuer, for integration tests.
- `@n8io/baseline-authn/client`: `authnRefreshClientMiddleware`, the root route's `clientMiddleware` that refreshes the token before it expires.

## Example

```ts
import {
	authnCreate,
	authnMiddleware,
	authnRoutes,
} from "@n8io/baseline-authn";
import { except } from "hono/combine";

const authn = await authnCreate({
	actorFromClaims: (claims) => ({
		id: String(claims.sub),
		kind: "user",
		scopes: [],
	}),
	audience: ENV.AUTHN_AUDIENCE,
	clientId: ENV.AUTHN_CLIENT_ID,
	clientSecret: ENV.AUTHN_CLIENT_SECRET,
	issuerUrl: ENV.AUTHN_ISSUER_URL,
	secret: ENV.AUTHN_SECRET,
});

app.use("*", except(["/api/*"], authnMiddleware(authn, { source: "cookie" })));
app.use("/api/v1/*", authnMiddleware(authn, { source: "bearer" }));
app.route("/auth", authnRoutes(authn));
```

## Needs

- Peers: `hono`, `react`, `react-router`, `zod` and `@opentelemetry/api`.
- Env, by the template's convention: `AUTHN_ISSUER_URL` (`https://` or `memory://`), `AUTHN_CLIENT_ID`, `AUTHN_CLIENT_SECRET`, `AUTHN_AUDIENCE`, and `AUTHN_SECRET` (base64url, at least 32 bytes; it encrypts the cookies).
