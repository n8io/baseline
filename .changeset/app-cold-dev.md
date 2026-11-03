---
"app": patch
---

A cold `pnpm dev` no longer reloads mid-load with a failed `entry.client.tsx` import: `vite.config.ts` pre-bundles `class-variance-authority`, `cn` and `radix-ui`. The template now has a `public/` folder for static files, so the dev server no longer logs that `./public` is missing.
