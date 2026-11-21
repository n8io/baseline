---
app: patch
---

Turn on the noFallthroughCasesInSwitch, noImplicitReturns and noPropertyAccessFromIndexSignature compiler flags and the Biome noFloatingPromises, noMisusedPromises, useAwaitThenable and useExhaustiveSwitchCases rules. Biome useLiteralKeys is off because it rewrites the bracket access the new flag requires. The architecture test now awaits `init()` from es-module-lexer.
