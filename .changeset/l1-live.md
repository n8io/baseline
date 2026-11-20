---
"@n8io/baseline-live": minor
---

Export `LiveTestSseReadOptions` from `/testing`. `liveStreamCreate` throws `TypeError("liveStreamCreate: expiresAt must be a number of epoch ms, …")` for a NaN or non-number `expiresAt` (it closed the stream at once before), and its wrong-hub and `liveTestSseRead` errors start with the function name.
