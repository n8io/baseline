---
"app": patch
---

`app-ci.yml@v2` adds a required `sast` job: Semgrep CE (pinned image, metrics off) with the `p/typescript`, `p/nodejs`, `p/react` and `p/secrets` rulesets, failing on any finding. app-create requires `ci / sast`. A suppression is `// nosemgrep: <rule-id> -- <reason>`, and `.semgrepignore` lists generated paths only.
