import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { reactRouterHonoServer } from "react-router-hono-server/dev";
import { defineConfig, type Plugin } from "vite";

// One URL per dev instance (the Project, or a linked worktree of it): PORT, failing loudly when it
// is taken, on <instance>.localhost so no two instances share a cookie.
const devUrlPrint: Plugin = {
	name: "dev-url-print",
	configureServer: (server) => {
		const urlsPrint = server.printUrls;
		server.printUrls = () => {
			urlsPrint();
			server.config.logger.info(
				`  ➜  Open:    http://${process.env.COMPOSE_PROJECT_NAME}.localhost:${process.env.PORT}/`,
			);
		};
	},
};

export default defineConfig({
	plugins: [
		devUrlPrint,
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
	server: { port: Number(process.env.PORT), strictPort: true },
});
