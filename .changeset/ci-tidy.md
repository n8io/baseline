---
"app": patch
---

The shared `app-ci.yml` no longer runs a separate `glossary-check` job: the glossary alias warnings now run as a step inside `check` and still show as annotations when `check` gets that far. The `image` job skips `pnpm install` (the Dockerfile installs inside the image), and the checkout keeps no credentials in `.git`. `pnpm run ci` now also runs `pnpm piece-check`, and `AGENTS.md` lists what it covers and what only CI runs. No required check changes.
