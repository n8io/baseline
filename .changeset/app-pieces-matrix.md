---
"app": patch
---

Run the `pieces` check of `app-ci.yml` as one job per piece (`piece (<name>)`), so it no longer outgrows its 10 minute limit as pieces are added. `pieces` stays the one required check: it passes when every piece job passed or was skipped. `pnpm piece-check --skip-tree` leaves out the unmodified-tree check that `check` and `unit` already run. `test/app-ci-pieces.test.ts` keeps the matrix equal to `pieceNames`.
