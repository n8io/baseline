---
"@n8io/baseline-queue": patch
---

The README's blocked-key runbook has a diagram again: an Event that fails all five attempts goes to `.dead`, its key is held while other keys carry on, and once it is given up the key moves on.
