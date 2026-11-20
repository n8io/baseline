# Reach a vendor's own settings by its client or a `vendor` option, never a client getter

Status: accepted, 2026-11-13

A Package's API names no vendor, so a Project can change vendor without changing callers, but a Project still needs settings only the vendor has (TLS, a region, a sample rate). Of the ways we compared, we chose two, both only on a factory whose name or Package is one vendor's: where the vendor has a client object, the factory takes the Project's client (B); where it does not, the factory takes a `vendor` option typed as the vendor's own settings (C), set only in the Project's wiring files. A handle that returns the raw vendor client (D) is never allowed, because every caller could then depend on the vendor. The rules are in docs/agents/packages.md and apps/app/docs/agents/vendor-settings.md.
