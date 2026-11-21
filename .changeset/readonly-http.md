---
"@n8io/baseline-http": minor
---

Exported types and functions take and return readonly arrays (errors, codes), so a caller's array is never edited and an array a Package returns cannot be. A mutable array a caller passes in still compiles; code that edits a returned array, or hands it to a function that wants `T[]`, copies it first.
