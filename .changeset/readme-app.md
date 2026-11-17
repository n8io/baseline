---
"app": patch
---

Every Project gets a README. `pnpm app-create` renders the new `README.md` with the Project's name and description and a link to the release it was made from; it shows how to start, what runs, how to add a Domain, every command, and where the agent docs are. A Project takes it with `pnpm template-upgrade`; one that already has its own `README.md` resolves the conflict by keeping the parts it wants.
