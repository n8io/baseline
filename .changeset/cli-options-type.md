---
"@n8io/baseline-cli": minor
---

`CliOptions`, the type `cliCreate` takes, is exported. A document or `operations` that `cliCreate` cannot turn into commands now throws a `TypeError` (still an `Error`) whose message starts with `cliCreate: document` or `cliCreate: operations`.
