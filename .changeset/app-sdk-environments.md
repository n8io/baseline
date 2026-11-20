---
"app": minor
---

The SDK piece runs on `@n8io/baseline-sdk`: every call gets a timeout (10 s per attempt, 30 s in all) and a GET, HEAD or DELETE is retried after a network failure, a timeout or a 408, 429, 500, 502, 503 or 504 (`retry: 0` turns it off, as an Event handler should). A caller picks an Environment by name instead of a URL: `clients/environments.json` lists them (the Template ships `development`), `sdkConfigure({ environment })` takes one, typed, and the `sdk-generate` script writes them into `clients/sdk/openapi.json` as `servers`, where the CLI's `--env` finds them. `baseUrl` stays as an override for tests and worktrees. `clients-release` now publishes the SDK and CLI to GitHub Packages on the Project's own repository with the workflow's `GITHUB_TOKEN`, never to public npm, so no first publish by hand or trusted publisher is needed; `docs/agents/clients.md` says how another repository installs them. Environment is a new glossary term.
