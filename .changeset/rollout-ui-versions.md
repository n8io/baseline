---
"app": minor
---

Survive pods of two UI versions during a rolling deploy.

While old and new pods serve side by side, a page from one version can ask a pod of the other for its hashed files. Before, that pod rendered a whole 404 page (or a redirect to sign-in) with no cache header, and the browser was left with a page without styles or scripts.

- `src/server.ts`: a request under `/assets/` for a file this build does not have answers a bare `404` with `cache-control: no-store`, so nothing in front keeps it and a retry can reach a pod that has the file.
- `src/ui/asset-reload-listen.ts`, inlined first in `<head>` by `src/ui/root.tsx`: when one of the page's own stylesheets or scripts fails to load, the page reloads once (a page that was itself reloaded this way does not reload again). React Router already reloads when a route's script fails to load or the route manifest's version has changed.
- `src/ui/csp-nonce.ts`: `CspNonce` gives a component the request's CSP nonce for an inline script of its own; `src/ui/entry.server.tsx` provides it.
- `test/integration/rollout.test.ts` runs two versions side by side; `productionServerStart` takes a `directory`.

To adopt it in a Project, copy those files and the `configure` option in `src/server.ts`. One reload narrows the window but cannot close it; to close it, serve `/assets/` from storage that keeps the previous build, or use session affinity.
