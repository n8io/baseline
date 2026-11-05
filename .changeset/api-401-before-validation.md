---
"app": patch
---

An `/api/v1` request without a signed-in Actor now answers 401 before any route validates its input, so an anonymous caller no longer learns the API's input shape from 400 errors. `/api/v1/openapi.json` stays public.
