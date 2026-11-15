---
"app": patch
---

The shared `app-ci.yml` `sast` job now scans with a pinned snapshot of the same Semgrep packs (`p/typescript`, `p/nodejs`, `p/react`, `p/secrets`: 121 rules at one commit of semgrep/semgrep-rules) instead of downloading them from semgrep.dev on every run, so a new upstream rule can no longer fail a pull request on its own. Rule ids and `nosemgrep` suppressions are unchanged, and the findings were the same on the Template and on the known Projects. `docs/agents/dependency-updates.md` says how the pin moves. No required check changes.
