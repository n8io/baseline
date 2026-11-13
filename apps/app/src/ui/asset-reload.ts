/**
 * Reloads the page once when one of this build's own files fails to load. During a rolling
 * deploy the page can come from a pod of one version and its `/assets/` requests reach a pod of
 * another, which answers 404; the reload asks for the page and its files again. A second failure
 * within ten seconds stays as it is, so a build that is really broken does not reload forever.
 *
 * root.tsx inlines this function's source in `<head>`, so it runs before any file loads and even
 * when the entry script is the file that failed. It must not use anything from outside its body.
 * React Router does the same for a route's script and for a changed route manifest.
 */
export const assetReloadListen = (): void => {
	const storageKey = "asset-reload-at";
	window.addEventListener(
		"error",
		({ target }) => {
			// A failed load fires on its element; a script that throws fires on window.
			const link = target instanceof HTMLLinkElement;
			if (!link && !(target instanceof HTMLScriptElement)) return;
			const url = link ? target.href : target.src;
			// React Router's inline module script has no src: one of its imports failed.
			const ours = url
				? url.startsWith(`${window.location.origin}/assets/`)
				: !link && target.type === "module";
			if (!ours) return;
			try {
				const reloadedAt = Number(sessionStorage.getItem(storageKey));
				if (Date.now() - reloadedAt < 10_000) return;
				sessionStorage.setItem(storageKey, String(Date.now()));
			} catch {
				// No session storage, no way to stop at one reload.
				return;
			}
			window.location.reload();
		},
		// Load errors do not bubble, so listen on the way down.
		true,
	);
};
