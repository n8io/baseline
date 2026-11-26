---
"app": patch
---

Fix the browser feature flag client never starting. `entry.client.tsx` read the client config from React Router's state before hydration had built it, so no client was made and every browser flag read its fallback. The server now renders the config into the page head as a JSON `<script id="feature-flags-config">` (`FeatureFlagsConfigScript`), and `entry.client.tsx` reads it from the document. The piece-marker budget is now 94. A Project that added the feature flags blocks by hand adds the `<FeatureFlagsConfigScript />` block to the `Layout` head in `src/ui/root.tsx`.
