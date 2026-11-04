---
"app": major
---

The template's CI calls `app-ci.yml@v2`, which needs no token: the `PACKAGES_TOKEN` secret, the GitHub Packages registry setup and every `NODE_AUTH_TOKEN` are gone, and the caller drops `packages: read` and `secrets: inherit`. Every action is pinned to a commit SHA, and Dependabot keeps those pins current. Projects move to `app-ci.yml@v2` and `dependabot-automerge.yml@v2`; `v1` stays frozen where it is.
