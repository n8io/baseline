---
"app": major
---

On a pull request, `app-ci.yml` runs only the tests its diff can reach. `ci / unit` runs `pnpm test --changed origin/<base>`: Vitest runs a test only when a file its imports reach changed, and every test when `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.node-version`, `tsconfig.json`, `.env.schema`, `.env.test` or a Vitest or Vite config changed, or when the pull request deletes a file. A new `changes` job (not a required check) reads the diff, and a pull request that changes only Markdown skips `ci / integration`, `ci / pieces` and `ci / image`; a skipped job satisfies its required check, so nothing waits. `check` and `sast` always run. A dispatched run still runs everything.

A test that reads or runs a file of the app by its path now declares it with `import.meta.glob([...], { query: "?raw" })`, so a change to that file still runs it, or says `// Reads and runs no file of the app`. `structure.test.ts` fails on a unit test that imports `node:fs` or `node:child_process` and does neither.

To upgrade a Project: `pnpm template-upgrade --to 10.0.0`. The ruleset keeps the same six required checks. A Project's own unit test that reads the disk needs the declaration before it passes `structure.test.ts`.
