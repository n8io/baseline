// The one file under src/ui that may log: handleError logs each thrown failure once.
import { PassThrough } from "node:stream";
import { logger } from "@n8io/baseline-logger";
import { telemetryRouterInstrumentation } from "@n8io/baseline-telemetry";
import { createReadableStreamFromReadable } from "@react-router/node";
import { renderToPipeableStream } from "react-dom/server";
import {
	type EntryContext,
	type HandleErrorFunction,
	isRouteErrorResponse,
	type RouterContextProvider,
	type ServerInstrumentation,
	ServerRouter,
} from "react-router";
import { cspNonceContext } from "./context.ts";

export const streamTimeout = 5_000;

// Names the HTTP server span after the route pattern and traces loaders and actions.
export const instrumentations: ServerInstrumentation[] = [
	telemetryRouterInstrumentation,
];

export const handleError: HandleErrorFunction = (error, { request }) => {
	// A client that went away, or a 4xx response such as a 404, is not a failure.
	if (request.signal.aborted) return;
	if (isRouteErrorResponse(error) && error.status < 500) return;
	logger.error({ err: error });
};

export default function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext,
	loadContext: RouterContextProvider,
): Response | Promise<Response> {
	if (request.method.toUpperCase() === "HEAD") {
		return new Response(null, {
			headers: responseHeaders,
			status: responseStatusCode,
		});
	}

	// ServerRouter hands the nonce to <Scripts>, <ScrollRestoration> and the streamed data scripts.
	const nonce = loadContext.get(cspNonceContext);
	const nonceProps = nonce === undefined ? {} : { nonce };
	return new Promise((resolve, reject) => {
		let status = responseStatusCode;
		let shellRendered = false;
		let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
			() => abort(),
			streamTimeout + 1000,
		);
		// Streams once the shell is ready; SPA mode waits for everything.
		const readyOption = routerContext.isSpaMode ? "onAllReady" : "onShellReady";

		const { abort, pipe } = renderToPipeableStream(
			<ServerRouter
				context={routerContext}
				url={request.url}
				{...nonceProps}
			/>,
			{
				...nonceProps,
				onError(error: unknown) {
					status = 500;
					// Shell errors reject and reach handleError; log only later stream errors.
					if (shellRendered) logger.error({ err: error });
				},
				onShellError(error: unknown) {
					reject(error);
				},
				[readyOption]() {
					shellRendered = true;
					const body = new PassThrough({
						final(callback) {
							clearTimeout(timeoutId);
							timeoutId = undefined;
							callback();
						},
					});
					responseHeaders.set("Content-Type", "text/html");
					pipe(body);
					resolve(
						new Response(createReadableStreamFromReadable(body), {
							headers: responseHeaders,
							status,
						}),
					);
				},
			},
		);
	});
}
