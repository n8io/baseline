---
"app": minor
---

`pnpm template-upgrade` handles a big rename better. A release lists what it renamed in `template-renames.json` (names, import paths, files) and the upgrade applies it to your own code after the merge, naming the files it changed. In `CONTEXT-MAP.md` it keeps your rows when the Template changes a table's columns. On a conflict it says the merge is left staged (do not run it again) and lists, per file, the lines only your side has, so an import lost in a conflict block shows up. `docs/agents/template-upgrade.md` says the same. To upgrade a Project: nothing to do; these apply from the upgrade after the one that brings them.
