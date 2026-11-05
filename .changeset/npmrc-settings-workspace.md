---
"app": patch
---

Move `autoInstallPeers: false` from `.npmrc`, which pnpm 12 ignores for non-auth settings, to `pnpm-workspace.yaml`, and delete `.npmrc`. Projects that upgrade lose `.npmrc` and the Dockerfile stops copying it; keep only auth and registry lines in any `.npmrc` you add.
