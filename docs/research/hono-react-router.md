# Running Hono and React Router in one process

Research for [#4](https://github.com/n8io/baseline/issues/4). Checked 2026-10-31. Versions are from the npm registry on that date.

## Answer

Use `react-router-hono-server` (Vite plugin plus a `createHonoServer()` Node adapter). It is the only option that gives Hono-owned middleware, API routes and typed load context in both `react-router dev` (HMR) and production, without us maintaining the dev-server glue. Frontend-only mode is a separate build of the same app code with `ssr: false` and no Hono plugin. It is a plain static `build/client` folder.

## Current versions

| Package | Version | Date | Notes |
|---|---|---|---|
| `react-router`, `@react-router/dev`, `@react-router/node`, `@react-router/express`, `@react-router/serve` | 8.5.1 | 2026-10-27 | v8.0.0 shipped 2026-06-17 |
| `react-router-hono-server` | 4.1.7 | 2026-10-27 | 9 releases since 2026-08-19 |
| `hono` | 4.13.14 | 2026-10-25 | |
| `@hono/node-server` | 2.1.5 | 2026-10-13 | |
| `@hono/vite-dev-server` | 0.26.1 | 2026-07-11 | |
| `vite` | 8.3.5 | 2026-10-21 | |

Source: `npm view <pkg>`.

## React Router 8 facts that matter here

From the [changelog](https://reactrouter.com/changelog):

- Requires Node 22.22.0+, React 19.2.7+, Vite 7+. ESM only.
- Middleware and the Vite Environment API are always on. The old future flags are gone.
- In a custom server, `getLoadContext` must return a `RouterContextProvider`, not a plain object ([middleware docs](https://reactrouter.com/how-to/middleware)).
- `@react-router/dev` 8.5.1 accepts `vite ^7 || ^8`.

## Option A: `react-router-hono-server` (recommended)

Source: [README on GitHub](https://github.com/rphlmr/react-router-hono-server) and the 4.1.7 tarball from npm.

How it works:

- A Vite plugin, `reactRouterHonoServer()` from `react-router-hono-server/dev`. It must come before `reactRouter()` in `plugins`.
- `app/server.ts` calls `createHonoServer()` from `react-router-hono-server/node`. Without that file, the plugin supplies a default virtual server. `npx react-router-hono-server reveal file` generates it.
- Hono owns middleware, API routes and load context. React Router owns routes, loaders, actions and rendering. The README says the same server entry is used in dev and in production.
- Dev: `react-router dev`. Build: `react-router build`. Start: `node ./build/server/index.js`. It replaces `@react-router/serve`; remove that package.
- Internally it depends on `@hono/vite-dev-server` 0.26.1 (dev) and `@hono/node-server` 2.1.5 (prod). Node WebSockets work alongside Vite HMR.
- Typed context: `createHonoServer({ getLoadContext(c) { ... } })` returning a `RouterContextProvider`.
- Keep `@react-router/node` on Node (it selects the Node streaming renderer).
- `basename` (React Router) and `base` (Vite) are separate settings and both are supported.

Constraints:

- Peer deps are strict: `vite >=8.3.0`, `react ^19.3.0`, `react-router ^8.3.1`, `@react-router/dev ^8.3.0`, `hono ^4.13.7`. Node >= 24.19.0 (engines field).
- One copy of react, react-dom, react-router, hono and vite only. Duplicates cause invalid-hook errors (README warning).

Maturity:

- One maintainer (rphlmr), 435 stars, MIT, not archived, last push 2026-10-29, 1 open issue (GitHub API).
- Nightly CI against the latest runtimes. It tracks React Router majors closely; 4.x supports RR 8 only. Risk: a bus factor of one, and it will lag if RR changes its dev plugin internals.

SPA / static: the README says `ssr: false` "generates static output and an SPA fallback for static hosting", and `ssr: true` with `prerender` serves the static files first and falls through to SSR. I did not run the plugin with `ssr: false`; whether leaving it in `vite.config.ts` is harmless is unverified (see below).

## Option B: `@hono/vite-dev-server` wired by hand

Source: [vite-plugins README](https://github.com/honojs/vite-plugins/tree/main/packages/dev-server).

- It serves any fetch-style app (Hono) from Vite in dev. HMR is client-side only. The README does not mention React Router.
- You would still need to make it coexist with `reactRouter()` (which owns the SSR environment and the `virtual:react-router/server-build` module) and write the prod entry (static files, `createRequestHandler`, `serve()`). Option A already does exactly this using the same plugin. No upside over A except dropping one dependency.

## Option C: hand-written server, Express template style

Source: [adapter docs](https://reactrouter.com/api/other-api/adapter), [`node-custom-server` template](https://github.com/remix-run/react-router-templates/tree/main/node-custom-server).

- The official pattern is for Express: `server/app.ts` calls `createRequestHandler({ build: () => import("virtual:react-router/server-build"), getLoadContext })`. `vite.config.ts` adds `build.rollupOptions.input: "./server/app.ts"` for the SSR build. A `server.js` runs Vite in middleware mode (`ssrLoadModule`) in dev and the built bundle in prod. Scripts run `node --conditions development server.js`.
- There is no official Hono adapter. The same shape works with Hono's `@hono/node-server` and the `createRequestHandler` from `react-router` (a Web `Request` handler, so it fits Hono directly). But Vite's dev server is Node-HTTP middleware, so you must bridge Hono and Vite yourself, and HMR websocket plumbing is ours to own.
- Most control, most code to keep working across RR and Vite upgrades.

## Option D: `@react-router/serve` plus a separate Hono process

Not "one process", so it does not meet the ticket. `@react-router/serve` 8.5.1 is Express 5 based. Mentioned for completeness only.

## Frontend-only (static SPA, no server)

Source: [SPA mode docs](https://reactrouter.com/how-to/spa).

- `react-router.config.ts`: `ssr: false`. No server build is generated.
- `react-router build` pre-renders only the root route into `index.html`; deploy `build/client` to any static host that rewrites all paths to `/index.html`.
- Build-time rendering still runs, so `@react-router/node` stays installed and root-route code must be SSR-safe (no `window` at module/initial render). Add `HydrateFallback` to the root route.
- Only the root route may have a server `loader`. Every other route must use `clientLoader` / `clientAction` (unless that route is pre-rendered). This is the main code constraint: the same route modules must use `clientLoader` to work in both SSR and SPA builds, or the app keeps two data-loading styles.
- Pre-rendering exists for individual pages ([how-to](https://reactrouter.com/how-to/pre-rendering)).

Suggested shape for the three modes (a design inference, not tested):

- `both`: `ssr: true`, Hono plugin in `vite.config.ts`, `app/server.ts` mounts API routes then the React Router handler.
- `frontend only`: `ssr: false`, no Hono plugin, no `app/server.ts`; routes use `clientLoader`. Output is static files.
- `backend only`: delete the `web` package and the React Router plugin; plain Hono with `@hono/node-server`, no Vite needed.

Removing the frontend means deleting the React Router/Vite config, the `web` package and the `reactRouter()` mount in `app/server.ts`. Adding it means the reverse. The coupling point is one line in `app/server.ts` plus one plugin entry.

## Unverified

- Behavior of `react-router-hono-server` when `ssr: false` and the plugin is still in `vite.config.ts` (README says supported; not run).
- Whether `react-router-hono-server` and OpenAPI-generating Hono routes coexist cleanly in `app/server.ts` (Hono routes are plain, so likely yes; not run).
- The `node-custom-server` template `server.js` was summarized by the fetch tool, not read verbatim.
- No HMR benchmark or stability test; dev experience claims come from the README.
