import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { reactRouterHonoServer } from "react-router-hono-server/dev";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		reactRouterHonoServer({ serverEntryPoint: "src/server.ts" }),
		reactRouter(),
		tailwindcss(),
	],
	// Unbundled server: every library stays in node_modules so OpenTelemetry can patch it.
	// Vite bundles linked workspace packages; this keeps every @n8io/ import external too.
	environments: {
		ssr: {
			build: {
				rollupOptions: {
					external: (id) => id.startsWith("@n8io/"),
				},
			},
		},
	},
	// The dev server finds these late (only the UI components import them) and reloads mid-load.
	optimizeDeps: {
		include: ["class-variance-authority", "cn", "radix-ui"],
	},
	resolve: {
		// One copy of each, even when a linked package resolves its own.
		dedupe: ["hono", "react", "react-dom", "react-router"],
	},
});
