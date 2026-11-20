---
"@n8io/baseline-cli": minor
---

`login` sends its token request through `@n8io/baseline-sdk`, so it gets the SDK's timeouts: it gives up after 10 s instead of waiting forever, and is sent once, never retried. When no answer comes it exits 1 with `login failed: POST <url>/auth/token got no answer: <reason>`.
