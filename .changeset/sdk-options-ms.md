---
"@n8io/baseline-sdk": major
---

Options follow the shared Package rules. `timeout` and `totalTimeout` are now `timeoutMs` and `totalTimeoutMs` (still milliseconds), and the type `sdkFetchCreate` takes is `SdkFetchOptions`, not `SdkFetchCreateInput`; there are no aliases, so rename them where you pass or import them. Every `SdkOptions` field takes `null`, which means the same as leaving it out. A bad `retry` (not a whole number of 0 or more) or a `timeoutMs` or `totalTimeoutMs` that is not a positive integer of at most 2147483647 now throws a `TypeError` that starts with the function and the option, such as `sdkConfigure: timeoutMs`, instead of reaching the network. The README's `clients/sdk/sdk-fetch.ts` example is now the Template's file, which orval can read.
