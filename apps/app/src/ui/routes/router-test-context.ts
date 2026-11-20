import type { Actor } from "@n8io/baseline-authn";
import {
	actorContext,
	authnExpiresAtContext,
} from "@n8io/baseline-authn/react-router";
import { type RouterContext, RouterContextProvider } from "react-router";

export const routerTestContextCreate = (
	actor: Actor | undefined,
	entries: [RouterContext<unknown>, unknown][] = [],
): RouterContextProvider =>
	new RouterContextProvider(
		new Map<RouterContext<unknown>, unknown>([
			[actorContext, actor],
			[authnExpiresAtContext, undefined],
			...entries,
		]),
	);

export const routerTestArgsCreate = <
	Params extends Record<string, string> = Record<never, never>,
>(options: {
	context: RouterContextProvider;
	form?: Record<string, string>;
	params?: Params;
	pattern?: string;
	url: string;
}) => {
	const url = new URL(`http://localhost${options.url}`);
	return {
		context: options.context,
		params: (options.params ?? {}) as Params,
		pattern: options.pattern ?? url.pathname,
		request: options.form
			? new Request(url, {
					body: new URLSearchParams(options.form),
					method: "POST",
				})
			: new Request(url),
		url,
	};
};
