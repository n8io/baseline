---
"@n8io/baseline-http": minor
---

`httpErrorResponses` now types each listed status, so a route whose responses all carry content can return its problem bodies, and only with those statuses. Adds the `HttpErrorResponses` type; a mistyped error type still fails type-checking.
