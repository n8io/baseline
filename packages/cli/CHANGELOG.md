# @n8io/baseline-cli

## 1.2.0

### Minor Changes

- f216435: `CliOptions`, the type `cliCreate` takes, is exported. A document or `operations` that `cliCreate` cannot turn into commands now throws a `TypeError` (still an `Error`) whose message starts with `cliCreate: document` or `cliCreate: operations`.

### Patch Changes

- e7bc75a: Internal names and tests tidied; adds the `test:unit` script so root `pnpm test:unit` runs this Package's tests.
- 84c85e1: README and doc comment wording: examples show their imports, Exports rows name each export, and glossary words read as the glossary writes them.
- 9a5b1a1: Package metadata in one voice: every Package commits its own copy of the MIT `LICENSE` (the tarball already carried the root one), and its npm description is rewritten from its README in the glossary's words. `@n8io/baseline-live` drops its unused optional `redis` peer and `@n8io/baseline-authn` its unused optional `react` peer; neither imports them. The `client` entries of authn and live build with `platform: "neutral"`, as they run in browsers (the output is unchanged).
- Updated dependencies [84c85e1]
- Updated dependencies [e7bc75a]
- Updated dependencies [9a5b1a1]
- Updated dependencies [f216435]
  - @n8io/baseline-sdk@2.0.0

## 1.1.0

### Minor Changes

- 0fe738d: The CLI picks an environment by name: `--env <name>`, else `<NAME>_ENV`, chooses a base URL from the OpenAPI document's `servers` (a server's `description` is the name). `--url` and `<NAME>_URL` stay as an override for tests, worktree instances and one-off servers; a flag beats an env var, and a URL overrides an environment. With neither an environment nor a URL, a command exits 1 and lists the names; `--help` lists them too. `login --env <name>` logs in to that environment, and the stored login now keeps one token per URL, so each environment keeps its own. `--env` joins the flags the CLI keeps for itself, so `cliCreate` throws on a field named `env`. `CliDocument` gains `servers`.

  To upgrade: log in again once (a login stored by 1.x is dropped). Set `<NAME>_ENV` (or pass `--env`) where you set `<NAME>_URL` today, once the SDK's `openapi.json` lists your environments; `<NAME>_URL` keeps working.
- d368a53: Flag help shows each field's description, allowed values (`enum`) and default, and a value outside the `enum` exits 1 before any request.
- 91c4516: `login` sends its token request through `@n8io/baseline-sdk`, so it gets the SDK's timeouts (10 s for the response, 30 s for the whole call) instead of waiting forever, and is sent once, never retried. When no answer comes it exits 1 with `login failed: POST <url>/auth/token got no answer: <reason>`.

### Patch Changes

- 315db5e: The README opens with a diagram of how a command reaches its SDK function, and its example matches the Template's `clients/cli/cli.ts`.
- Updated dependencies [03d501e]
  - @n8io/baseline-sdk@1.0.0

## 1.0.0

### Major Changes

- 5ddc04e: Add `@n8io/baseline-cli`: `cliCreate({ document, name, operations })` turns a Project's OpenAPI document and its generated SDK functions into a command line client. Each operation is `<tag> <rest of operationId>` in kebab-case (`fooCreate` under the tag `foo` is `foo create`), its path, query and body fields are kebab-case flags, and `--data` sends a body from JSON or `@file.json`. A response prints its JSON to stdout; a Problem prints its title and code to stderr and exits 1. The base URL is `--url` or `<NAME>_URL`; the token is `--token`, then `<NAME>_TOKEN`, then the one `<name> login --client-id <id>` stored (client credentials against `/auth/token`, the secret from `<NAME>_CLIENT_SECRET` or stdin, kept in the OS config directory with mode 600 and sent only to the URL it came from).
