---
"app": minor
"@n8io/baseline-postgres": minor
---

Refuse a cursor an integer column cannot hold. `CursorKind` gains `integer`: `cursorDecode` reads a cursor whose value is not a whole number from -2147483648 to 2147483647 as none, so the list shows its first page instead of a 500. `postgresKeysetCreate` takes `kind: "integer"` (an `integer` or `serial` column only) and throws a `TypeError` for a number its `integer` or `smallint` sort column cannot hold, whatever the kind. The Foo contract test pages every sort, with ties, through the new `cursorTestPagesCheck` helper.
