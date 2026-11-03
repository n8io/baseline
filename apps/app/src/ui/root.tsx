import { authnExpiryContext } from "@n8io/baseline-authn";
import { authnRefreshClientMiddleware } from "@n8io/baseline-authn/client";
import type { ReactNode } from "react";
import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root.ts";
import appCss from "./app.css?url";

export const links: Route.LinksFunction = () => [
	{ href: appCss, rel: "stylesheet" },
];

// authnRefreshClientMiddleware reads `authnExpiresAt` from this loader's data.
export const loader = ({ context }: Route.LoaderArgs) => ({
	authnExpiresAt: context.get(authnExpiryContext),
});

export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
	authnRefreshClientMiddleware,
];

export const Layout = ({ children }: { children: ReactNode }) => (
	<html lang="en">
		<head>
			<meta charSet="utf-8" />
			<meta content="width=device-width, initial-scale=1" name="viewport" />
			<Meta />
			<Links />
		</head>
		<body className="min-h-dvh bg-background text-foreground antialiased">
			{children}
			<ScrollRestoration />
			<Scripts />
		</body>
	</html>
);

export default function App() {
	return <Outlet />;
}

// Thrown failures land here. Production shows a generic message; handleError logs the details.
export const ErrorBoundary = ({ error }: Route.ErrorBoundaryProps) => {
	const known = isRouteErrorResponse(error);
	const title = known ? `${error.status} ${error.statusText}` : "Error";
	const message =
		known && error.status === 404
			? "This page does not exist."
			: "Something went wrong.";
	const stack =
		import.meta.env.DEV && error instanceof Error ? error.stack : undefined;
	return (
		<main className="mx-auto max-w-2xl p-6">
			<h1 className="font-semibold text-2xl">{title}</h1>
			<p className="mt-2 text-muted-foreground">{message}</p>
			{stack && (
				<pre className="mt-4 overflow-x-auto rounded-md bg-muted p-4 text-sm">
					{stack}
				</pre>
			)}
		</main>
	);
};
