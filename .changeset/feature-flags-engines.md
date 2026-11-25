---
"@n8io/baseline-feature-flags": patch
---

The server and browser flags: reads never throw and fall back with a logged reason, `ready` never rejects, browser snapshots are stable and notify only the flags that changed, and in-memory flags for tests from `/testing`.
