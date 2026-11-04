---
"app": patch
---

The Node preloads live in one file, `src/preload.ts`: it loads varlock, registers the OpenTelemetry ESM loader hook and starts telemetry, in that order. Scripts run `node --import ./src/preload.ts <entry>`, and the image sets `NODE_OPTIONS="--import /app/src/preload.ts"` once, so its CMD and the compose worker are plain `node <entry>`. A runner that passes its own command should drop the flags and run `node src/worker.ts` or `node src/migrate.ts`. `dockerfile.test.ts` checks the one `NODE_OPTIONS` line and fails if the telemetry or loader-hook preload is named anywhere but `src/preload.ts`.
