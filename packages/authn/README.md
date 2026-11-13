# @n8io/baseline-authn

OIDC sign-in for pages, JWT verification for the API, and the Actor both hand to use cases.

```sh
pnpm add @n8io/baseline-authn
```

## Exports

- `authnCreate(options)`: discovers the OIDC provider, or starts the memory issuer when `issuerUrl` is `memory://`. The memory issuer signs anyone in without a password, so `memory://` also needs `memoryIssuerAllowed: true`; pass it only in development and test. Returns the `Authn` the other functions take; it is opaque, with no fields to read. `actorFromClaims` gets the verified token's claims as `AuthnClaims`, a plain `Record<string, unknown>`.
- `authnMiddlewareCreate(authn, { source })`: sets `c.var.actor` from a `"bearer"` token (API) or the `"cookie"` session (pages). A missing token stays anonymous; an invalid one is a 401 or a redirect to sign-in.
- `authnRoutesCreate(authn)`: `/sign-in`, `/callback`, `/refresh` and `/sign-out`, mounted at `/auth`.
- `authnActorRequire(c)`: the signed-in Actor of an API request, else 401.
- `Actor`: the type `{ id, kind: "user" | "client", scopes }`. What `actorFromClaims` returns is checked against it, and anything else counts as an invalid token.
- `AuthnRequiredError`: the 401 `authnActorRequire` throws.
- `authnMemoryTokenCreate({ authn, actor })`: a bearer token from the memory issuer, for tests that hold the `Authn`.

The main entry imports nothing from React or React Router, so an API or Worker installs neither. Pages import the two subpaths:

- `@n8io/baseline-authn/react-router`: `actorContext` and `authnExpiryContext`, the React Router contexts the load context fills, and `authnPageActorRequire(args)`, the signed-in Actor of a loader or action (else a document redirect to sign-in).
- `@n8io/baseline-authn/client`: `authnRefreshClientMiddleware`, the root route's `clientMiddleware` that refreshes the token before it expires.

Tests import one more:

- `@n8io/baseline-authn/testing`: `authnTestSignIn({ url, who, secret })`, which signs in at a served app in a test. See [Testing](#testing).

## Example

```ts
import {
	authnCreate,
	authnMiddlewareCreate,
	authnRoutesCreate,
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
	// memory:// is refused unless this is true; never true in production.
	memoryIssuerAllowed: ENV.APP_ENV !== "production",
	secret: ENV.AUTHN_SECRET,
});

app.use(
	"*",
	except(["/api/*"], authnMiddlewareCreate(authn, { source: "cookie" })),
);
app.use("/api/v1/*", authnMiddlewareCreate(authn, { source: "bearer" }));
app.route("/auth", authnRoutesCreate(authn));
```

### Checking claims with Zod

You bring your own schema library. To check the token's claims with Zod, parse them in `actorFromClaims`; a throw means the token is not an Actor's:

```ts
import type { Actor, AuthnClaims } from "@n8io/baseline-authn";
import { z } from "zod";

const Claims = z.object({
	sub: z.string().min(1),
	scope: z.string().default(""),
});

export const actorFromClaims = (claims: AuthnClaims): Actor => {
	const { sub, scope } = Claims.parse(claims);
	return { id: sub, kind: "user", scopes: scope.split(" ").filter(Boolean) };
};
```

## Testing

A test that holds the `Authn` gets a bearer token with `authnMemoryTokenCreate`. A test that only has a served app's URL signs in with `authnTestSignIn` from `@n8io/baseline-authn/testing`. Both need the memory issuer (`issuerUrl` `memory://`). Import the helper from test files only.

```ts
import { authnTestSignIn } from "@n8io/baseline-authn/testing";

const signedIn = await authnTestSignIn({
	secret: ENV.AUTHN_SECRET,
	url: "http://localhost:3000",
	who: "admin",
});

await fetch("http://localhost:3000/api/v1/invoices", {
	headers: { authorization: signedIn.authorization },
});
await fetch("http://localhost:3000/invoices", {
	headers: { cookie: signedIn.cookie },
});
```

- `who` is `"admin"` (the Dev admin, with `memoryAdminScopes`) or `"user"` (the Dev user, with no scopes).
- `secret` is the server's `secret`. The helper opens the access cookie with it, and throws when it is another server's.
- It returns `authorization` (the `Authorization` header value), `cookie` (the `Cookie` header value), `token` (the access token) and `accessCookie` (the access cookie's sealed value).

## Needs

- Peers: `hono` and `@opentelemetry/api`. The package uses Zod inside, as its own dependency; you do not install it. `react` and `react-router` are optional peers, needed only for the `/react-router` and `/client` subpaths.
- Env, by the template's convention: `AUTHN_ISSUER_URL` (`https://` or `memory://`), `AUTHN_CLIENT_ID`, `AUTHN_CLIENT_SECRET`, `AUTHN_AUDIENCE`, and `AUTHN_SECRET` (base64url, at least 32 bytes; it encrypts the cookies).
