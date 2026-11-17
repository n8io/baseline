---
"app": patch
---

Every Project gets a README. `pnpm app-create` renders the new `README.md` with the Project's name and description and a link to the release it was made from; it shows how to start, what runs, how to add a Domain, the commands, and where the agent docs are. A Project takes it with `pnpm template-upgrade`. The `Made from` line names the release, so it changes with every release: a Project that rewrote its `README.md` or removed that line resolves a README conflict at each upgrade by keeping its own text (docs/agents/template-upgrade.md). After `pnpm piece-remove`, drop what the README says about the piece (docs/agents/pieces.md).
