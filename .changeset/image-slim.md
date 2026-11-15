---
"app": patch
---

The production image is smaller: the Dockerfile deletes source maps and type declarations (`*.map`, `*.d.ts`, `*.d.mts`, `*.d.cts`) from the production `node_modules`, which Node never reads at run time. The Template's full render went from 430 MB to 324 MB, and with every piece removed it went from 342 MB to 302 MB. `image-budget.json` drops from 430 to 360 MB, and `docs/agents/deploy.md` says how a Project sets its own.

To upgrade a Project: run `pnpm template-upgrade`; it takes `Dockerfile`, `dockerfile.test.ts`, `docs/agents/deploy.md` and `image-budget.json`. A Project that kept the Template's 430 gets 360. A Project that set its own budget gets a conflict in `image-budget.json`: keep yours, then lower it to your next `image` job's `Image: N MB` plus about 10%. A Project whose production dependency reads `.d.ts` or `.map` files at run time excludes that package in the Dockerfile's `find` line.
