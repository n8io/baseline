---
"@n8io/baseline-authn": major
"@n8io/baseline-http": major
"@n8io/baseline-id": major
"@n8io/baseline-postgres": major
"@n8io/baseline-queue": major
"@n8io/baseline-shutdown": major
---

Exports follow the full naming rule: factories end in `Create`, predicates end in `Is`, `Has` or `Can`, and every export starts with its package's name. No old names remain as aliases. Rename these imports:

- authn: `authnRoutes` → `authnRoutesCreate`, `authnMiddleware` → `authnMiddlewareCreate`.
- http: `httpErrorResponses` → `httpErrorResponsesCreate`, `httpErrorBody` → `httpErrorBodyCreate`, `httpProblemSchema` → `httpProblemSchemaCreate`.
- id: `idSchema` → `idSchemaCreate`.
- postgres: `postgresIdColumn` → `postgresIdColumnCreate`, `postgresTransaction` → `postgresTransactionRun`, `postgresUniqueViolation` → `postgresUniqueViolationIs`.
- queue: `consumerCreate` → `queueConsumerCreate`, `consumersStart` → `queueConsumersStart`, `consumersSubscribe` → `queueConsumersSubscribe`, `scheduleCreate` → `queueScheduleCreate`, `schedulesRegister` → `queueSchedulesRegister`.
- shutdown: `shutdownHandle` → `shutdownHandleCreate`.
