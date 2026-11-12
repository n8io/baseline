---
"@n8io/baseline-http": minor
"app": minor
---

`httpCsrf` wraps Hono's `csrf()` for cookie-authenticated routes: a form, multipart or text POST answers a 403 `Forbidden` problem unless `Sec-Fetch-Site` is `same-origin` or `Origin` is the server's public origin (https when `x-forwarded-proto` says so). The app runs it on every route except `/api/*`, which uses bearer tokens, so a cross-site post to a page action or to `/auth/sign-out` no longer relies on `SameSite=Lax` alone. A TLS-terminating proxy must set `x-forwarded-proto: https`.
