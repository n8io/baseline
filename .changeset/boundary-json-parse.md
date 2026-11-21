---
"app": patch
---

The API reference page and `pnpm piece-remove` read `package.json`, `dependencies-allowed.json` and `biome.json` with a Zod schema instead of a type cast, so a file of the wrong shape fails with a message that names the field.
