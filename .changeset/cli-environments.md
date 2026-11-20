---
"@n8io/baseline-cli": minor
---

The CLI picks an environment by name: `--env <name>`, else `<NAME>_ENV`, chooses a base URL from the OpenAPI document's `servers` (a server's `description` is the name). `--url` and `<NAME>_URL` stay as an override for tests, worktree instances and one-off servers; a flag beats an env var, and a URL overrides an environment. With neither an environment nor a URL, a command exits 1 and lists the names; `--help` lists them too. `login --env <name>` logs in to that environment, and the stored login now keeps one token per URL, so each environment keeps its own. `--env` joins the flags the CLI keeps for itself, so `cliCreate` throws on a field named `env`. `CliDocument` gains `servers`.

To upgrade: log in again once (a login stored by 1.x is dropped). Set `<NAME>_ENV` (or pass `--env`) where you set `<NAME>_URL` today, once the SDK's `openapi.json` lists your environments; `<NAME>_URL` keeps working.
