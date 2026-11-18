---
"@n8io/baseline-cli": major
---

Add `@n8io/baseline-cli`: `cliCreate({ document, name, operations })` turns a Project's OpenAPI document and its generated SDK functions into a command line client. Each operation is `<tag> <rest of operationId>` in kebab-case (`fooCreate` under the tag `foo` is `foo create`), its path, query and body fields are kebab-case flags, and `--data` sends a body from JSON or `@file.json`. A response prints its JSON to stdout; a Problem prints its title and code to stderr and exits 1. The base URL is `--url` or `<NAME>_URL`; the token is `--token`, then `<NAME>_TOKEN`, then the one `<name> login --client-id <id>` stored (client credentials against `/auth/token`, the secret from `<NAME>_CLIENT_SECRET` or stdin, kept in the OS config directory with mode 600 and sent only to the URL it came from).
