---
"@n8io/baseline-queue": patch
---

The README's order diagram now shows a retry that succeeds: a failed Event holds its key's later Events until its retry, then every Event is handled in order.
