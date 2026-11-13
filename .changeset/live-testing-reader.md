---
"@n8io/baseline-live": minor
"app": patch
---

`@n8io/baseline-live/testing` is new: `liveTestSseRead({ response })` reads a live stream in a test. `until(text)` waits for text to arrive, `end()` waits for the server to end the stream and `cancel()` goes away like a page that closes. Import it from test files only. The README has a Testing section with the memory hub and the reader together.

In the Template, the Foo tests read their live streams with this reader, so no test reads a response body by hand. When you upgrade, a Domain test that copied the hand-written reader can use `liveTestSseRead` in its place.
