# Roles, scopes and machine clients

Read when a task depends on who may do what: a new role, a scope, a Use case only a machine may call, a dev user to try a role, or a script that calls the API.

## Where scopes come from

- Production: the identity provider puts them in the access token. `actorFromClaims` in `src/authn.ts` reads them (the default reads the space-separated `scope` claim; the comment above it lists the claims of other providers) and returns the `Actor`: `{ id, kind: "user" | "client", scopes }`. Switching providers edits that file.
- Development and test: the memory issuer, `AUTHN_ISSUER_URL=memory://`. `src/authn.ts` lists its users (`authnMemoryUsersCreate`) and machine clients (`authnMemoryClientsCreate`). Only development and test may use it; in production `memory://` refuses to boot.

## Scopes and specifications

- A context's `index.ts` exports its scopes, `<context>Scopes` (`invoiceScopes = ["invoice:refund"] as const`). `src/server.ts` spreads each into the one `scopes` list; `pnpm aggregate-create` adds the new Aggregate's there.
- A scope means a permission, not a role. A role is a set of scopes the provider grants a group.
- A specification in `domain/<aggregate>.ts` reads the Actor and answers yes or no: `actor.scopes.includes("invoice:refund") || invoice.createdBy === actor.id`. The transition that needs it calls it and returns the forbidden error (`invoiceRefund(invoice, { actor, now })`), so no Use case can skip it; a delete, which has no transition, checks it in the Use case; the route and the page never check a scope themselves.
- Only a machine may call it: `actor.kind === "client"`, in a specification such as `invoiceImportCan`. A user holding every scope still fails it.

## Actors that are not a person

An Event handler, an anti-corruption layer and a Schedule call Use cases with an Actor they build themselves, `{ id: "invoice-schedule", kind: "client", scopes: [] }`. The Use case checks it like any other, so give it only the scopes that Use case's specifications need. Never hand it a list of every scope.

## One dev user per role

`authnMemoryUsersCreate` returns Dev user (no scopes) and Dev admin (every scope). When a context has a role between them, add a user for it, so the sign-in page offers it and a developer can try what that role sees:

```ts
{ id: "dev-manager", name: "Dev manager", scopes: ["invoice:refund"] },
```

The sign-in page shows one button per entry, labelled with `name`. A test signs in as one with `authnTestSignIn({ secret, url, who: "dev-manager" })`.

## A dev machine token

`authnMemoryClientsCreate` returns `dev-client` with every scope. A script or a seed run against a served app asks for its token:

```ts
const { authorization } = await authnMemoryTokenFetch({
	clientId: "dev-client",
	url: "http://localhost:3000",
});
await fetch("http://localhost:3000/api/v1/invoices", {
	headers: { authorization },
});
```

The token lives 15 minutes. A script that can run longer asks `authnMemoryAuthorizationCreate({ clientId, url })` for a function instead, and calls it for the `Authorization` value of each request: it renews the token before it expires ([scripts.md](scripts.md)).

The token's Actor has `kind: "client"`. The key behind it comes from `AUTHN_SECRET`, so every Server that shares the secret accepts it, behind a load balancer too. With a real provider there is no `/auth/token`: create the client at the provider.

## Tests

- A route test builds the app and signs a bearer token for any Actor with `authnTestBearerCreate({ actorFromClaims })` from `@n8io/baseline-authn/testing`.
- A test that needs a real database opens its connections with `connectionsOpen({ role: "publisher", urls: { cache: "memory://", database: databaseUrl } })`. A field left out keeps the variable's value; a real database makes the queue and Events real too.

## Cookies

Sign-in cookies carry the `__Host-` prefix, which browsers accept on `http://localhost` and on https, not on `http://127.0.0.1` or a LAN name. Open the app at `localhost`.
