# App

@CONTEXT.md

Run with Node 26 (`.node-version`) and the pnpm version pinned in `packageManager`.

## Verify

Commands by role. Integration tests and the dev server need `docker compose up -d`.

- setup: `pnpm install`
- format: `pnpm format`
- lint + format check + typecheck: `pnpm check` (30 s budget)
- unit tests: `pnpm test` (2 min budget; memory adapters only)
- integration tests: `pnpm test:integration` (3 min budget)
- mutation tests: `pnpm test:mutation` (changed files, break threshold 80%)
- full CI-equivalent: `pnpm ci`
- dev server: `pnpm dev` (runs migrate, then the Worker, with health on port 9001, beside the dev server)
- build: `pnpm build`
- codegen: `pnpm codegen` (run after editing a `spi/*-table.ts` file)
- migrate: `pnpm migrate`
- seed: `pnpm seed`
- new domain: `pnpm domain-create`
- template upgrade: `pnpm template-upgrade`
- glossary warnings: `pnpm glossary-check`

Dev, tests, the worker, migrate and seed run TypeScript directly with erasable syntax only. Imports carry the `.ts` extension and use `#imports`, not path aliases.

When a budget trips, decide again deliberately: make the code faster or set a new budget. Never raise it quietly.

## Where new work goes

One Domain per business entity. Copy the `foo` Domain in `src/domains/foo/`.

| Kind of work                                                                   | File                      |
| ------------------------------------------------------------------------------ | ------------------------- |
| Use cases (types and factory), Port types, Event schemas, scopes, input Models | `index.ts`                |
| Port declarations                                                              | `ports.ts`                |
| Domain errors                                                                  | `foo-errors.ts`           |
| Models (Zod schema and inferred type)                                          | `models/foo.ts`           |
| Rules (pure functions over Models, one per file, with a test)                  | `rules/foo-deletable.ts`  |
| One Use case per file, with a test on memory adapters                          | `use-cases/foo-create.ts` |
| HTTP routes, live streams, Consumers, Schedules, Seeds                         | `api/`                    |
| Port implementations, tables, contract tests                                   | `spi/`                    |

- Outside code imports only `index.ts`, `api/index.ts` and `spi/index.ts`.
- The Domain never imports `api/` or `spi/`. Composition roots wire them.
- A Use case applies Rules. The API and the SPI hold no business rules.
- Name things generic to specific: entity first (`fooCreate`), then the action. `Error` and `Repository` come last.
- A read across Domains goes through a Bridge in `src/bridges/`. A reaction goes through an Event.
- UI pages live in `src/ui/`. They import Domains only through `index.ts`.

### Stop and ask

Stop and ask the user when:

- the work fits no single Domain;
- a glossary term is new or changes meaning, or a new business verb or Event is needed;
- a new Domain is needed (propose a name and a one-line definition);
- a new dependency is needed, including any UI dependency beyond Tailwind, shadcn/ui, `cn()` and lucide;
- a hard rule, its check or a budget would change;
- a second pattern would be added for something that has one;
- a transaction needs a timeout longer than 5 s;
- a migration needs a `destructive.md`;
- the `oasdiff` check would be skipped;
- the app would accept card data;
- the app would start a child process at runtime;
- an OpenTelemetry instrumentation would be added;
- a secret cannot come from `.env.schema` and 1Password.

Other hard rules: no `any`; every Biome suppression states a reason; no `@ts-expect-error` or `@ts-ignore` in `src/domains/**`; every test asserts with `expect()`; Vitest is the only runner.

## Glossary rules

- `CONTEXT.md` is the source of truth for names in code, tests, UI copy, tickets, PRs and commits. Never use an `_Avoid_` alias.
- Never edit `## Architecture`. Propose the change to baseline.
- Ask before adding or changing a term. Give the term, the definition and the `_Avoid_` list. Never add or edit a term the user did not answer.
- The entry lands in the same PR. The PR body has a "Glossary" section listing each change as agreed.
- Removing a Domain removes its glossary entry in the same PR.
- Existing code that uses another word for a term gets a rename ticket, one per term. Do not rename in passing.
- Renames go everywhere, with expand then contract.
- Run `pnpm glossary-check` before a PR and judge each hit.

## Snippets

### Consumer with the inbox

A Consumer lives in the reacting Domain's `api/`, one file per Event. It is subscribed in `server.ts` and `worker.ts` and runs only in `worker.ts`. Wire it at `// domain-create: consumers`.

```ts
// src/domains/billing/api/billing-order-placed-consumer.ts
import { orderPlaced } from "#domains/order/index.ts"; // the one allowed cross-domain import: Event schemas only
const billingOrderPlacedConsumerActor: Actor = {
	id: "billing-order-placed-consumer",
	kind: "client",
	scopes: ["billing:invoice-create"],
};
export const billingOrderPlacedConsumer = (u: BillingUseCases) =>
	consumerCreate(
		"billing.order-placed",
		"order.placed",
		orderPlaced,
		(event, inbox) =>
			u.invoiceCreate(
				billingOrderPlacedConsumerActor,
				{ customerId: event.customerId, amountCents: event.totalCents },
				inbox,
			),
	);
```

- Delivery is at least once. The Use case takes `inbox` as its last argument and passes it to its transaction port: `billingTransaction(work, inbox)`.
- The adapter inserts `(consumer, eventId)` into `queue.inbox` in the same transaction. A repeat skips the work and returns `ok`.
- Such a Use case returns `Result<void, E>`.
- Publish an Event only inside the Use case's transaction, through `fooEvents`.
- A Domain whose ids other Domains hold publishes `<entity>.deleted`. Each Domain holding that id consumes it and decides what to do with its rows.

### Bridge

A Bridge fills a Port of the reading Domain by calling another Domain's `*Get` or `*List` Use case with its own machine Actor. Reads only. Never write across Domains. Wire it at `// domain-create: bridges`.

```ts
// billing/ports.ts
export type BillingCustomerReader = {
	get(
		id: Id<"customer">,
	): Promise<{ email: string; taxRegion: string } | undefined>;
};

// src/bridges/billing-customer.ts (the only file that knows both Domains)
const billingCustomerBridgeActor: Actor = {
	id: "billing-customer-bridge",
	kind: "client",
	scopes: [],
};
export const billingCustomerReader = (
	customer: CustomerUseCases,
): BillingCustomerReader => ({
	get: async (id) => {
		const r = await customer.customerGet(billingCustomerBridgeActor, {
			customerId: id,
		});
		return r.ok
			? { email: r.value.email, taxRegion: r.value.taxRegion }
			: undefined;
	},
});
```

### Aggregate

- One repository per Aggregate root, named after it. Its tables live in `spi/`.
- A supporting Model gets no repository. Save and load it through the root's repository.
- A transaction may change more than one Aggregate, but only within one Domain.

## Rules no tool checks

- An action calls exactly one write Use case. A loader may call any number of read Use cases across Domains.
- Do one write per Use case where possible.
- Do not make slow outside calls inside a transaction. The 5 s timeout is the only guard.
- A scheduled Use case handles everything due as of now, not a fixed batch. One catch-up run must cover any number of missed ticks, and a repeat must change nothing.
- Make cut-off work safe to redo. Delivery is at least once everywhere.
- Reuse an existing shadcn component before making one. Add components only with `pnpm shadcn add <name>`. Never write them by hand.

## Data rules

- Postgres 17 or newer.
- Change schemas with expand then contract. A rename is an added column in one release and a dropped one in a later release.
- Run `pnpm codegen` after editing a table file. A PR may only add folders under `migrations/`.
- On a migration conflict, delete your migration, rebase and run `pnpm codegen` again. Never use `--fix-conflicts` or `--hints`.
- Destructive SQL (`DROP`, `RENAME`, `ALTER COLUMN ... TYPE`, `SET NOT NULL`) needs a `destructive.md`. Adding one is a stop-and-ask.
- No foreign keys across Domains. Store another Domain's id as a plain indexed `uuid` column.
- Do not use `sql.raw` in `spi/`.

## Env and secrets

- Declare every variable in `.env.schema`. Secrets are `@sensitive` by default.
- A secret's production value is an `op()` reference in `.env.production`. Never put a value in a committed file.
- Read `ENV` from `#env`. Never read `process.env`.
- Put dev and test values in `.env.development` and `.env.test`.
- `memory://` URLs are allowed only in development and test.

## Privacy

- Logs, spans and metrics carry only ids, error codes, class names, counts and timings. Never a Model, an input or error message text.
- Paths and queries never carry personal data. Path parameters are ids.
- Card numbers never enter the app. Accepting card data is a stop-and-ask.
- At deploy time, recommend the OpenTelemetry Collector `redaction` processor as a second line of defence.

## Runtime notes

- Give each entry `OP_SERVICE_ACCOUNT_TOKEN` and outbound HTTPS to 1Password. Secrets are fetched at boot.
- Use 5 to 15 minute access tokens.
- Use `parentbased_traceidratio` sampling for busy services.
- Set `OTEL_LOGS_EXPORTER=none` when stdout is already shipped.
- The runner must allow a 30 s grace period.
- Run `pnpm migrate` once before the new version starts. The server and the Worker may then start in any order.
- The load balancer must speak HTTP/2 and allow long-lived responses (live updates use SSE).
- Probe `/livez` and `/readyz` on `HEALTH_PORT` (9000).
- After `pnpm template-upgrade`, resolve every conflict marker before committing.
