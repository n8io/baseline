---
"@n8io/baseline-live": minor
---

`react` and `react-router` are now optional peers, needed only for `@n8io/baseline-live/client`, so a service that only sends or streams live updates can install live without React. `useLiveUpdates` takes an optional `{ pathPrefix }` (default `/live`) for a Project that mounts the streams elsewhere.
