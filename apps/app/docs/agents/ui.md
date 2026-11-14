# UI pages

Read when adding, changing, testing or removing a page under `src/ui/`. The examples use a `bar` Domain; a Domain made by `pnpm domain-create` starts with the same two pages, `<domain>-list.tsx` and `<domain>-detail.tsx`, under its own name.

## A page

One React Router route module per page, `src/ui/routes/<domain>-<view>.tsx`, listed in `src/ui/routes.ts` above `// domain-create: routes`. It exports a `loader`, an `action` when the page changes anything, the page component as default, and an `ErrorBoundary` when the loader can throw. The UI reaches a Domain only through its `index.ts` (A10).

## Loader

The loader requires a signed-in Actor, reads its input from the URL with the Domain's input type, and gets the Use cases from the load context. It may call any number of read Use cases across Domains.

```ts
// src/ui/routes/bar-list.tsx
export const loader = async (args: Route.LoaderArgs) => {
	const actor = authnPageActorRequire(args);
	const cursor = new URL(args.request.url).searchParams.get("cursor");
	const input = BarListInput.parse(cursor === null ? {} : { cursor });
	const result = await args.context
		.get(barUseCasesContext)
		.barList(actor, input);
	if (!result.ok) {
		throw result.error;
	}
	return { items: result.value.items, nextCursor: result.value.nextCursor };
};
```

- Each Domain's Use cases are one context key, `<domain>UseCasesContext` in `src/ui/context.ts`. `pnpm domain-create` adds the key and its entry in `uiLoadContextCreate`.
- A Use case error the page cannot go on from (not found, forbidden) is thrown as `data(...)` with its status from the Domain's exported `barErrorStatus`, keyed by the error's `type` (the same table the API uses). Never write a status literal for a Use case's error.
- Show a control only when the Actor may use it: call the Domain's exported "can" predicates in the loader and return booleans. The Use case still checks; the predicate only hides what it would refuse.

```ts
// src/ui/routes/bar-detail.tsx
const barErrorThrow = ({ message, type }: BarError): never => {
	throw data({ type, message }, { status: barErrorStatus[type] });
};
```

```ts
// src/ui/routes/bar-detail.tsx
const bar = result.value;
return {
	can: { delete: barDeleteCan(bar, actor), update: barUpdateCan(bar, actor) },
	bar,
};
```

- The `ErrorBoundary` branches on the error's `type`, not on `barErrorStatus`: a value import from the Domain in a component ships the Domain's code to the browser. Import only its types there.

## Action

An action calls exactly one write Use case. A page with several forms tells them apart by a hidden `intent` field and calls one Use case per intent.

- Parse the form with the Domain's input type. On failure return `data({ errors: z.flattenError(parsed.error).fieldErrors, values }, { status: 400 })`, so the form shows each field's errors and keeps what was typed.
- On success, `redirect` to the changed entity, or return `{ ok: true }` to stay.
- A refused change the user can fix is a message on the page, not an error page: return `data({ errors, values }, { status: barErrorStatus.BarNameTaken })` and render it beside the form. Throw the rest with `barErrorThrow`; the `ErrorBoundary` shows them.
- Words for a refused change: `error.message`, or, when users need other words, a `Record<BarError["type"], string>` in `src/ui/lib/<domain>-error-message.ts`, so a new error fails to compile until it has words.
- Pending state comes from `useNavigation()`: disable the form's buttons while it submits.

## Live updates

A page that shows an entity others can change reruns its loaders when that entity changes. The call sits between the page's `piece-start: live` and `piece-end: live` lines, so `pnpm piece-remove live` takes it out.

```ts
// src/ui/routes/bar-detail.tsx
useLiveUpdates({ channel: "bar", id: bar.id });
```

- The channel is the Domain, the id the entity's. The Domain's Use case sends on that channel after commit, and `api/<domain>-live.ts` serves the stream only to an Actor its read Use case allows.
- A hook cannot be called conditionally. A page that follows a second entity only some of the time passes `id: null` while there is none: no stream opens.

## Forms

- Use React Router's `<Form method="post">` with the shadcn `Input`, `Label` and `Button`, so every form posts without JavaScript.
- A choice in a form that must work without JavaScript is a native `<select name="...">`. Use the shadcn `Select` (`pnpm shadcn add select`) only where the page needs JavaScript anyway.
- `<input type="datetime-local">` sends `YYYY-MM-DDTHH:mm` with no zone. Read it as UTC: check the pattern, then ``new Date(`${value}:00Z`)``, and let the Domain's input type refuse the Invalid Date. Say "(UTC)" in the label.

## Page tests

A page test sits beside its page and calls `loader` and `action` directly, with every Domain built on memory connections the same way the Server builds them.

```ts
// src/ui/routes/bar-list.test.ts
const connections = await connectionsOpen({ role: "publisher" });

const setup = (actor: Actor | null = owner) => {
	const useCases = domainsUseCasesCreate(connections).barUseCases;
	const context = routerContextCreate(actor ?? undefined, [
		[barUseCasesContext, useCases],
	]);
	return { context, useCases };
};
```

- `routerContextCreate` and `routeArgs` in `router-test-context.ts` build the context and the request. Pass one `[context key, Use cases]` entry per Domain the page reads.
- Check what a thrown `data(...)` carries with `toMatchObject({ data: { type }, init: { status } })`.

## Removing a page

Delete its route module and test, and its line in `src/ui/routes.ts`, then run `pnpm check`: `react-router typegen` deletes the page's generated route types, which otherwise break `tsc`.
