# Keep one throw in Use cases: `// unreachable:`

Status: accepted, 2026-11-18

Use cases and Aggregate rules return `err()` for every expected outcome and never throw or catch (architecture rule A27). We kept one escape: a bug that cannot happen may `throw new Error(...)` directly under a one-line `// unreachable: <why>` comment. In an Event handler an `err` completes the Event silently, while a throw retries it and holds its Event key, so a bug fails loudly without anyone remembering to rethrow. Never use it for not-found, forbidden, conflict or validation.
