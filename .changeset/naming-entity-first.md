---
"app": patch
---

Template naming: AGENTS.md spells out the generic-to-specific rule (scope, subject, then action; factories end in `Create`, predicates in `Is`), and architecture rule A23 fails an exported name that starts with a verb. The integration helpers become `integrationSignIn` (in `integration-sign-in.ts`), `productionServerWaitFor` and `productionServerConnectResult`, and `loadContextCreate` becomes `uiLoadContextCreate`.
