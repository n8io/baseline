---
"app": patch
---

`domain-create` works in a Project made from app@8, and its CI pin follows the Template.

- `domain-create` no longer treats a Markdown file as a wiring target. The Template's `CHANGELOG.md` quotes marker lines in its upgrade notes, so without this every `pnpm domain-create` in a Project would stop with "CHANGELOG.md is missing; the template wires domains there".
- `.github/workflows/ci.yml` calls `app-ci.yml` and `dependabot-automerge.yml` at the Template's own major (`@v8` for app@8), and `pnpm run version` moves that pin with every Template major, so a Project never runs an older CI than its Template expects.

To upgrade a Project: `pnpm template-upgrade` moves `ci.yml` to `@v8`, which brings the required `pieces` job and the stricter `migrations` check; run `pnpm piece-check` before you push the upgrade.
