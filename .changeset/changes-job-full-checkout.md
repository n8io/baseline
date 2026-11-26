---
"app": patch
---

The `changes` job in `app-ci.yml` checks out every blob instead of a partial clone. On a large pull request diff, `git diff` needed a blob it did not have, tried to fetch it with no credentials, and failed with "could not read Username".
