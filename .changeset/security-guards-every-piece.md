---
"app": patch
---

`src/server-wiring.test.ts` proves the security guards with any pieces removed: the CSP and secure headers on every kind of response, `httpCsrf` on every `/auth` post, the `__Host-` session cookie, and 401 on every anonymous `/api/v1` operation before its route reads the body.
