# @n8io/baseline-result

## 1.1.4

### Patch Changes

- e7bc75a: Internal names and tests tidied; adds the `test:unit` script so root `pnpm test:unit` runs this Package's tests.
- 9a5b1a1: Package metadata in one voice: every Package commits its own copy of the MIT `LICENSE` (the tarball already carried the root one), and its npm description is rewritten from its README in the glossary's words. `@n8io/baseline-live` drops its unused optional `redis` peer and `@n8io/baseline-authn` its unused optional `react` peer; neither imports them. The `client` entries of authn and live build with `platform: "neutral"`, as they run in browsers (the output is unchanged).
- d580a34: The code moves from `src/index.ts` to `src/result.ts`, every export has a JSDoc, and the README lists its exports in a table.

## 1.1.3

### Patch Changes

- 97f64ad: The README now says Use cases never throw: only adapters throw, for the unexpected.

## 1.1.2

### Patch Changes

- e1fafaf: Rewrite the README: a promise, a Guarantees table, a short example and the reference folded below.

## 1.1.1

### Patch Changes

- 5985c99: Docs match the code: the telemetry README shows the one preload file the Template uses (no `--experimental-loader`), the result README shows errors as `Error` subclasses with a `type` field, the queue Consumer example passes a machine Actor, the glossary adds Inbox and Repository, and `grafana/otel-lgtm` is pinned to a version tag.

## 1.1.0

### Minor Changes

- daecd9a: The @n8io/baseline-* packages publish publicly to npmjs, so installs need no npm token. Projects drop the `@n8io:registry` line from `.npmrc`, and the image builds with no `packages_token` secret.

### Patch Changes

- 6e5f6e7: baseline is open source under the MIT license, and every package declares `"license": "MIT"`. The template is fetched over plain HTTPS, so `domain-create` and `template-upgrade` no longer need a `gh` login; `app-create` needs one only to create the project repo.
- 793ad13: Each package ships a README on npmjs: what it does, how to install it, its exports, an example, and the env vars and peers it needs.

## 1.0.0

### Major Changes

- 81a9ef4: First release of the twelve shared packages.
