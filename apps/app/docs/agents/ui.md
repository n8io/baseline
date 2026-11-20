# UI pages

Read when adding, changing, testing or removing a page under `src/ui/`. The examples use a `baz` context and its Aggregate Baz; an Aggregate made by `pnpm aggregate-create` starts with the same two pages, `<aggregate>-list.tsx` and `<aggregate>-detail.tsx`, under its own name.

## A page

One React Router route module per page, `src/ui/routes/<aggregate>-<view>.tsx`, listed in `src/ui/routes.ts` above `// wiring: routes`. It exports a `loader`, an `action` when the page changes anything, the page component as default, and an `ErrorBoundary` when the loader can throw. The UI reaches a bounded context only through its `index.ts` (A10).

## Loader

The loader requires a signed-in Actor, reads its input from the URL with the context's input type, and gets the Use cases from the load context. It may call any number of read Use cases across bounded contexts.

```ts
// src/ui/routes/baz-list.tsx
export const loader = async (args: Route.LoaderArgs) => {
	const actor = authnPageActorRequire(args);
	const cursor = new URL(args.request.url).searchParams.get("cursor");
	const input = BazListInput.parse(cursor === null ? {} : { cursor });
	const result = await args.context
		.get(bazUseCasesContext)
		.bazList(actor, input);
	if (!result.ok) {
		throw result.error;
	}
	return { items: result.value.items, nextCursor: result.value.nextCursor };
};
```

- Each bounded context's Use cases are one router context key, `<context>UseCasesContext` in `src/ui/context.ts`. A context's first Aggregate with pages adds the key and its entry in `uiLoadContextCreate`.
- A Use case error the page cannot go on from (not found, forbidden) is thrown as `data(...)` with its status from the context's exported `bazErrorStatus`, keyed by the error's `type` (the same table the API uses). Never write a status literal for a Use case's error.
- Show a control only when the Actor may use it: call the context's exported "can" specifications in the loader and return booleans. The Use case still checks; the specification only hides what it would refuse.

```ts
// src/ui/routes/baz-detail.tsx
const bazErrorThrow = ({ message, type }: BazError): never => {
	throw data({ type, message }, { status: bazErrorStatus[type] });
};
```

```ts
// src/ui/routes/baz-detail.tsx
const baz = result.value;
return {
	can: { delete: bazDeleteCan(baz, actor), update: bazUpdateCan(baz, actor) },
	baz,
};
```

- The `ErrorBoundary` branches on the error's `type`, not on `bazErrorStatus`: a value import from the context in a component ships the context's code to the browser. Import only its types there.

## Action

An action calls exactly one write Use case. A page with several forms tells them apart by a hidden `intent` field and calls one Use case per intent.

- Parse the form with the context's input type. On failure return `data({ errors: z.flattenError(parsed.error).fieldErrors, values }, { status: 400 })`, so the form shows each field's errors and keeps what was typed.
- On success, `redirect` to the changed entity, or return `{ ok: true }` to stay.
- A refused change the user can fix is a message on the page, not an error page: return `data({ errors, values }, { status: bazErrorStatus.BazNameTaken })` and render it beside the form. Throw the rest with `bazErrorThrow`; the `ErrorBoundary` shows them.
- Words for a refused change: `error.message`, or, when users need other words, a `Record<BazError["type"], string>` in `src/ui/lib/<context>-error-message.ts`, so a new error fails to compile until it has words.
- Pending state comes from `useNavigation()`: disable the form's buttons while it submits.

## Live updates

A page that shows an entity others can change reruns its loaders when that entity changes. The call sits between the page's `piece-start: live` and `piece-end: live` lines, so `pnpm piece-remove live` takes it out.

```ts
// src/ui/routes/baz-detail.tsx
useLiveUpdates({ channel: "baz", id: baz.id });
```

- The channel is the Aggregate's name, the id the entity's. Its Use case sends on that channel after commit, and `adapters/inbound/<aggregate>-live-routes.ts` serves the stream only to an Actor its read Use case allows.
- A hook cannot be called conditionally. A page that follows a second entity only some of the time passes `id: null` while there is none: no stream opens.

## Forms

- Use React Router's `<Form method="post">` with the shadcn `Input`, `Label` and `Button`, so every form posts without JavaScript.
- A choice in a form that must work without JavaScript is a native `<select name="...">`. Use the shadcn `Select` (`pnpm exec shadcn add select`) only where the page needs JavaScript anyway.
- `<input type="datetime-local">` sends `YYYY-MM-DDTHH:mm` with no zone. Read it as UTC: check the pattern, then ``new Date(`${value}:00Z`)``, and let the context's input type refuse the Invalid Date. Say "(UTC)" in the label.

## Page tests

A page test sits beside its page and calls `loader` and `action` directly, with every bounded context built on memory connections the same way the Server builds them.

```ts
// src/ui/routes/baz-list.test.ts
const connections = await connectionsOpen({ role: "publisher" });

const setup = (actor: Actor | null = owner) => {
	const useCases = contextsCreate(connections).bazContext.useCases;
	const context = routerTestContextCreate(actor ?? undefined, [
		[bazUseCasesContext, useCases],
	]);
	return { context, useCases };
};
```

- `routerTestContextCreate` and `routerTestArgsCreate` in `router-test-context.ts` build the context and the request. Pass one `[context key, Use cases]` entry per bounded context the page reads.
- Check what a thrown `data(...)` carries with `toMatchObject({ data: { type }, init: { status } })`.

## Removing a page

Delete its route module and test, and its line in `src/ui/routes.ts`, then run `pnpm check`: `react-router typegen` deletes the page's generated route types, which otherwise break `tsc`.
