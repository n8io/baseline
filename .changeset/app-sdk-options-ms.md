---
"app": major
---

The SDK piece runs on `@n8io/baseline-sdk` 2: a caller that sets the SDK's timeouts passes `timeoutMs` and `totalTimeoutMs`, not `timeout` and `totalTimeout`, for one call or in `sdkConfigure`. `docs/agents/clients.md` opens with when to read it.
