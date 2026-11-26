// The API reference page: Swagger UI served from this app's own origin at /api/v1/docs, reading
// /api/v1/openapi.json. The one file that names the viewer; `pnpm piece-remove api-reference`
// deletes it with its test, its block in server.ts and its dependency.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { httpRouterCreate } from "@n8io/baseline-http";
import type { Context } from "hono";
import { z } from "zod";

const packageManifestSchema = z.object({ version: z.string() });

const assetBody = ({ directory, name }: { directory: string; name: string }) =>
	readFileSync(join(directory, name));

/**
 * The router mounted at `/api/v1/docs`: the page, and the viewer's script and stylesheet under a
 * URL that holds the package version, so the browser keeps them for a year. The CSP allows only
 * this origin and a per-request nonce, so both script tags carry the nonce and nothing is
 * inline but the one start-up call. Reads the two files once, so a missing package fails at boot.
 */
export const apiReferenceRoutesCreate = () => {
	const manifest = createRequire(import.meta.url).resolve(
		"swagger-ui-dist/package.json",
	);
	const directory = dirname(manifest);
	const { version } = packageManifestSchema.parse(
		JSON.parse(readFileSync(manifest, "utf8")),
	);
	const script = assetBody({ directory, name: "swagger-ui-bundle.js" });
	const style = assetBody({ directory, name: "swagger-ui.css" });
	const base = `/api/v1/docs/${version}`;
	const immutable = "public, max-age=31536000, immutable";

	const router = httpRouterCreate();
	router.get("/", (c) => {
		// httpSecureHeadersCreate sets it; the router's own Context does not type that variable.
		const nonce = (c as Context).var["secureHeadersNonce"];
		c.header("cache-control", "no-store");
		return c.html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>API reference</title>
<link rel="stylesheet" href="${base}/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="${base}/swagger-ui-bundle.js" nonce="${nonce}"></script>
<script nonce="${nonce}">SwaggerUIBundle({ dom_id: "#swagger-ui", url: "/api/v1/openapi.json", validatorUrl: null });</script>
</body>
</html>
`);
	});
	router.get(`/${version}/swagger-ui-bundle.js`, (c) =>
		c.body(script, 200, {
			"cache-control": immutable,
			"content-type": "text/javascript; charset=utf-8",
		}),
	);
	router.get(`/${version}/swagger-ui.css`, (c) =>
		c.body(style, 200, {
			"cache-control": immutable,
			"content-type": "text/css; charset=utf-8",
		}),
	);
	return router;
};
