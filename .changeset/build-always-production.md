---
"app": patch
---

`pnpm build` always makes a production build. With `NODE_ENV=development` in the shell, `react-router build` made a development build that compiled out the server shutdown (`import.meta.env.PROD` was false), so SIGTERM killed the server at once.
