# @n8io/baseline-cli

**A command line client for your API in about 20 lines**: `cliCreate` reads the Project's OpenAPI document and turns every operation into a command that calls the generated SDK, so `fooCreate` under the tag `foo` is `acme foo create --name x`.

```sh
pnpm add @n8io/baseline-cli
```

## Guarantees

| You get                             | How                                                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Commands named like the API**     | `<tag> <rest of operationId>` in kebab-case, grouped by tag in `--help`, with each operation's summary and description as its help.                        |
| **Flags for every field**           | Path, query and JSON body fields become kebab-case flags (`customerId` is `--customer-id`); `--data '<json>'` or `--data @file.json` sends a whole body.   |
| **Output scripts can read**         | A response prints its JSON to stdout. A Problem prints `title: code` to stderr and exits 1, so `&&` and `set -e` stop on it.                               |
| **Secrets kept off the screen**     | `login` reads the client secret from `<NAME>_CLIENT_SECRET` or stdin, never a flag, and stores the token in the OS config directory with mode 600.         |
| **A token only where it came from** | The stored login is sent only to the URL it was issued by, and only until it expires.                                                                      |
| **A document it can name**          | `cliCreate` throws at once on an operation without exactly one tag that its operationId starts with, or with no SDK function, instead of on a user's call. |

## Example

```ts title="clients/cli/src/cli.ts"
#!/usr/bin/env node
import { cliCreate } from "@n8io/baseline-cli";
import * as operations from "@acme/acme-sdk";
import document from "../openapi.json" with { type: "json" };

await cliCreate({ document, name: "acme", operations }).run(process.argv.slice(2));
```

```sh
export ACME_URL=http://localhost:3000
echo "$SECRET" | acme login --client-id ci
acme foo create --name x
```

Test it as its users run it: start the CLI as a child process over a fixture document and fake operations that answer with the arguments they got, and read its stdout, stderr and exit code (`src/cli-create.test.ts`).

## Reference

<details><summary><b>Exports</b></summary>

| Export                                      | Does                                                                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cliCreate({ document, name, operations })` | Builds the CLI. `document` is the OpenAPI document; `name` is the command's name and, upper snake cased, its env var prefix; `operations` maps each operationId to its SDK function. |
| `Cli`                                       | `run(argv)` runs one command from the arguments after the script (`process.argv.slice(2)`) and sets `process.exitCode`.                                                              |
| `CliOperation`                              | An SDK function, called as described below.                                                                                                                                          |
| `CliOperationResponse`                      | What an SDK function resolves to: `{ status, data }`.                                                                                                                                |
| `CliRequest`                                | The last argument of every call: `{ baseUrl, token? }`.                                                                                                                              |
| `CliDocument`                               | The parts of an OpenAPI document the CLI reads.                                                                                                                                      |

</details>

<details><summary><b>How a command calls its SDK function</b></summary>

The arguments are, in order:

1. each path field, in the order the path names them;
2. the body, if the operation has one: `--data` first, then each body flag over it;
3. the query object, if the operation has query fields (`undefined` when none is set);
4. a `CliRequest`, `{ baseUrl, token }`, for the SDK's fetch to read.

The function resolves to `{ status, data }`. A status of 400 or more is a failure: the CLI prints `data.title` and `data.code` to stderr (or `HTTP <status>` and the body when it is not a Problem) and exits 1. Otherwise it prints `data` as JSON, or nothing when there is no body.

</details>

<details><summary><b>Flags and values</b></summary>

- A path field is a required flag. A body field that the schema requires is marked required in its help but may come from `--data` instead.
- `integer` and `number` fields are parsed as numbers, `boolean` fields are flags without a value, `array` fields take several values (`--tags a b`), and any other field takes JSON (falling back to the text).
- `--url`, `--token`, `--data` and `--help` belong to the CLI; `cliCreate` throws on a field with one of those names, or on two fields with the same flag.
- `$ref`s inside the document are followed.

</details>

<details><summary><b>Base URL, token and login</b></summary>

- The base URL is `--url`, else `<NAME>_URL`. Without one, a command exits 1 and says so.
- The token is `--token`, else `<NAME>_TOKEN`, else the stored login for that base URL.
- `<name> login --client-id <id> [--scope <scopes...>]` posts `grant_type=client_credentials` to `<url>/auth/token`, with the app's `Origin` for its CSRF check. The client secret is `<NAME>_CLIENT_SECRET`, else piped stdin, else none (the Template's development issuer needs none).
- The login is stored at `$XDG_CONFIG_HOME/<name>/login.json`, else `~/Library/Application Support/<name>/login.json` on macOS, `%APPDATA%\<name>\login.json` on Windows and `~/.config/<name>/login.json` elsewhere: the folder is mode 700 and the file 600.

</details>

**Needs** Node 26 and a generated SDK (the Template's `sdk` piece). Runs on commander, which never appears in its types.
