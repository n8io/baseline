---
"@n8io/baseline-postgres": major
---

`postgresUniqueViolationIs` is renamed `postgresErrorIsUniqueViolation`, so a predicate reads model first, then `Is`. To upgrade, rename the import and each call.
