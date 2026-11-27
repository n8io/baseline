// What removing the ui Piece does: it leaves the Hono app serving itself and drops React Router's setup.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
	manifestEdit,
	objectParse,
	recordOmit,
	textEdit,
} from "./pieces-manifest.ts";

const biomeSchema = z.looseObject({
	css: z.unknown().optional(),
	files: z.looseObject({ includes: z.array(z.string()) }),
});

// Without the pages, Vite builds only src/server.ts.
const apiViteConfig = `import { defineConfig } from "vite";

// Builds src/server.ts into build/server/index.js, one file per source file so import.meta.main
// stays true only there. Every library stays in node_modules so OpenTelemetry can patch it.
export default defineConfig({
	build: {
		outDir: "build/server",
		rollupOptions: {
			output: {
				entryFileNames: (chunk) => (chunk.isEntry ? "index.js" : "[name].js"),
				preserveModules: true,
				preserveModulesRoot: "src",
			},
		},
		ssr: "src/server.ts",
	},
	ssr: { external: true },
});
`;

// Without React Router, src/server.ts serves its Hono app itself.
const apiServeLines = `
// Node runs this file in development and its build in production; tests only import it.
if (import.meta.main) {
	void serverCreate().then(({ app, serverListening, serverServe }) =>
		serverServe(serve({ fetch: app.fetch, port: ENV.PORT }, serverListening) as Server),
	);
}
`;
const nodeServerImport = 'import { serve } from "@hono/node-server";\n';

export const uiEdit = (directory: string) => {
	textEdit({
		directory,
		path: "biome.json",
		edit: (text) => {
			const { css: _css, ...biome } = objectParse(biomeSchema, text);
			return `${JSON.stringify(
				{
					...biome,
					files: {
						...biome.files,
						includes: biome.files.includes.filter(
							(p) => p !== "!.react-router",
						),
					},
				},
				null,
				"\t",
			)}\n`;
		},
	});
	writeFileSync(join(directory, "vite.config.ts"), apiViteConfig);
	textEdit({
		directory,
		path: "src/server.ts",
		edit: (text) =>
			text.includes("serverServe(serve(")
				? text
				: `${text.replace(/^import /m, `${nodeServerImport}import `)}${apiServeLines}`,
	});
	manifestEdit(directory, (manifest) => ({
		...manifest,
		imports: recordOmit(manifest.imports, ["#ui/*"]),
		scripts: {
			...manifest.scripts,
			build: "vite build",
			dev: manifest.scripts["dev"]?.replace(
				pieceDevUi,
				"node --watch --import ./src/preload.ts src/server.ts",
			),
		},
	}));
};

// The parts of the `dev` script the ui and queue removals edit (structure.test.ts holds them to it).
export const pieceDevUi =
	"node --import ./src/preload.ts --conditions=development ./node_modules/@react-router/dev/bin.cjs dev";
