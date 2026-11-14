# Scripts that call the API

Read when a task adds a script to `scripts/` that talks to a running app: a smoke check, a feed, an import, a load run. `scripts/api-smoke.ts` (`pnpm api-smoke`) is the pattern; copy it and change what it calls.

## What a script does, in order

1. Parses its flags with `parseArgs` from `node:util`, strict, so an unknown flag fails. `--help` prints the usage and exits 0. A default lives in the option, not in the code below it.
2. Waits for the app with a deadline. The app may still be booting, so poll a cheap route (`/api/v1/openapi.json`) every 500 ms until it answers or `--wait` seconds pass, then fail with what it waited for. Never loop without a deadline, and never `sleep` a guessed number of seconds.
3. Gets a token. In development and test the memory issuer hands one to a machine client; the script never signs a token itself and never imports `@n8io/baseline-authn/testing`:

```ts
const { authorization } = await authnMemoryTokenFetch({
	clientId: "dev-client",
	url,
});
```

The client and its scopes are in `src/authn.ts` ([authn.md](authn.md)). Against a real provider there is no such route: pass a token in through a variable instead, never as a flag, which shell history keeps.
4. Does its work and prints one line per call with its outcome, then a summary line with the counts.
5. Sets `process.exitCode` (0 when every call succeeded, 1 when any failed) and returns. It never calls `process.exit`, because that skips the next step.
6. Flushes telemetry last, in a `finally`, with `await telemetryShutdown()`. The script runs through `src/preload.ts` like every entry, so its calls are spans in the same trace as the Server's; unflushed spans are lost when the process ends.

## The package.json line

```json
"api-smoke": "node --import ./src/preload.ts scripts/api-smoke.ts"
```

The preload loads the environment (varlock) and the telemetry SDK. A script that needs neither (a pure file tool such as `glossary-check`) runs as `node scripts/<name>.ts`.

## Rules

- A script is not an import target: the part worth testing is a pure function it exports (`apiSmokeRoutesFind`), tested in `scripts/<name>.test.ts`, and the file runs `main` only under `if (import.meta.main)`.
- A script that needs a served app is tested in `test/integration/`, which boots the production build on memory adapters (`productionServerStart`) and runs the script as a child process. Set the three `OTEL_*_EXPORTER` variables to `none` for the child: with an OTLP endpoint and no collector, the last export holds the exit for seconds.
- Exports follow the naming rules like everything else: entity first, `apiSmokeRoutesFind`, not `findRoutes`.
- Seed data is not a script: `pnpm seed` runs `src/seed.ts`. A `<domain>Seed` ensures each example row by its natural key (create, and when the Use case answers that the key is taken, read the row that holds it) and returns every row it ensured, so it converges from an empty, half-seeded or seeded database, and a later seed takes the ids it needs from the result.
