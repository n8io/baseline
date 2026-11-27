---
"@n8io/baseline-shared": patch
---

Adds `sharedVendorKeyRefused({ allowed, vendor })`, the one check that a `vendor` object holds only the keys a Package allows. It returns the first refused key, so each caller keeps its own error message and names no vendor.
