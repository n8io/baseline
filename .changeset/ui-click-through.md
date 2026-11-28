---
"app": major
---

The Template's `app-ci.yml` runs its browser tests in a new `browser` job (`ci / browser`, a required check): the click-through flows of sign-in, the home redirect, the foo list and detail and a create and an edit, plus one smoke test per UI Piece that proves its page renders. A Project's ruleset needs `ci / browser` added; `requiredJobs` in `scripts/app-create-ruleset.ts` lists it for new Projects. A Project that removes a UI Piece also removes that Piece's smoke test (`pnpm piece-remove` deletes it).
