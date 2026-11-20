---
"@n8io/baseline-shutdown": patch
---

shutdownHandleCreate refuses a `deadlineMs` above 2147483647 (what a timer can hold), and its messages end `found X`. README: the shutdown steps have their own fold.
