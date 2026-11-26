---
"@n8io/baseline-http": minor
---

`httpSecureHeadersCreate({ connectSrc? })` builds the secure headers middleware with extra origins in the CSP's `connect-src`, for a page whose own scripts call another origin. The policy now always names `connect-src 'self'`, which it used to take from `default-src`, so the header gains that directive. `httpSecureHeaders` is unchanged otherwise.
