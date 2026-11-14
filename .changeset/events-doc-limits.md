---
"app": patch
---

`docs/agents/events.md` covers what an agent had to guess about Events: where per-key order stops (a Consumer that needs another key's row creates it on demand, a redriven dead Event runs late, a version guard for stale Events), Consumers that write a shared Aggregate (lock the root, in id order), fan-out in a Consumer (one lock order, chunks under the bind-parameter limit, several transactions before the 5 s limit), a column holding another Domain's id ships with its `deleted` Consumer (rule A14) and the repository side of that clean-up, testing a Consumer with `queueTestConsumerRun`, when one release is enough to change an Event's shape and what must be drained before you narrow, and naming for analytics and live channels beside Events.

To upgrade a Project: take `docs/agents/events.md` from the Template.
