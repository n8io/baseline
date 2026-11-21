---
"@n8io/baseline-authn": patch
---

The client's token refresh reads the refresh response without a type cast: a body that is not an object with a numeric `expiresAt` is ignored.
