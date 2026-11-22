---
"app": minor
---

A Biome plugin, `lint-plugins/max-params.grit`, fails a default-exported function with three or more inputs, which Biome's `useMaxParams` skips. It takes one typed object like every other function. Function types are already checked by `useMaxParams`; method signatures in types are still not.
