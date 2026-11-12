---
"@n8io/baseline-postgres": major
"app": major
---

`postgresPortsGuard` moves out of `@n8io/baseline-postgres` into the Template as `transactionPortsGuard` in `src/transaction-ports-guard.ts`, because it guards any transaction's ports and the memory transaction adapter used it too. When you upgrade, copy `src/transaction-ports-guard.ts` from the Template, and in each Domain's `spi/*-transaction.memory.ts` and `spi/*-transaction.postgres.ts` replace the `postgresPortsGuard` import from `@n8io/baseline-postgres` with `import { transactionPortsGuard } from "../../../transaction-ports-guard.ts"`.
