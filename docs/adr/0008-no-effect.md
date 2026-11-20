# Do not adopt Effect

Status: accepted, 2026-11-18

We looked at Effect for the Packages and the Template, in full or only inside Packages, to make code more deterministic and new patterns harder to invent. We declined: Effect 4.0 shipped in October 2026 while agents mostly know the 3.x API, Effect offers several styles for each task (more ways, not one), its types in a public API would break the vendor-neutral rule, and using it only inside a Package loses the benefit at the edge. Baseline already has the parts that matter (Result, ports, the Clock port, memory adapters, no mocks, repo checks), and added two checks instead: no throw or catch in Use cases (A27) and the runtime dependency allowlist. Revisit in 2027.
