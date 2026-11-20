---
"@n8io/baseline-http": patch
---

`httpErrorHandle` logs its 500 with a message ("Request failed; answered 500 InternalError"). Doc comments say "bounded context" and "business error" instead of "domain", every export has a JSDoc, internal helpers take the `http` prefix, the keep-alive values name their copy in health, and the README examples show their imports.
