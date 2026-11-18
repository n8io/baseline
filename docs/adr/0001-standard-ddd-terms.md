# Use the standard DDD and hexagonal terms

Status: accepted, 2026-11-18

Baseline named its parts in its own words: a Domain was one business entity, a Model held no behaviour and Rules sat beside it, and API, SPI, Consumer, Bridge and Outcome Events stood for ideas that DDD and hexagonal architecture already name. Agents and people who know those books had to learn a second vocabulary, and the Template could not hold several Aggregates in one boundary. We decided to follow common practice, in Nate's words "I want to follow common practices": the glossary takes the standard terms (Bounded context, Aggregate root, Entity, Value object, Invariant, Specification, Domain service, Inbound and Outbound adapter, Domain event, Published language, Event handler, Anti-corruption layer, Saga, Projection, Outbox, Subdomain, Context map, Shared kernel), and each old word becomes an `_Avoid_` alias of its replacement so `glossary-check` catches stragglers. Each bounded context also becomes one deep module in Matt Pocock's sense: one interface, tested at that interface, with a seam only where two adapters exist, so the glossary gains Module, Interface, Seam and Adapter as his codebase-design skill defines them. The full plan, with its term table, folder shape and tickets, is <https://claude.ai/artifact/3NxA5iPCbdKE7L3YxdY265> (epic n8io/baseline#464).

## Considered options

- **Keep Baseline's names.** No churn, but every reader translates, and the departures in shape (one entity per Domain, behaviour-free Models) stay hidden behind words that look standard.
- **Rename only.** Swap the words and keep the shape. Cheaper, but "Bounded context" would then name what is still one entity, and "Aggregate" one whose invariants a Use case can bypass: standard words with non-standard meanings, which is worse than our own words.
- **Standard terms and the shape they imply (chosen).** Contexts hold several Aggregates, Aggregates guard their own invariants through pure transitions, and each context has one interface. This is the biggest Template change so far, and fantasy-golf is the only Project to re-home, so now is the cheapest time.

## Consequences

- The code moves to the new words ticket by ticket (n8io/baseline#466 to #474). Until n8io/baseline#473 lands, `apps/app/CONTEXT.md` has an `_Allowed until_` line that keeps the old words out of `glossary-check`; that ticket removes it.
- Use case, Port, Repository, Aggregate, Inbox, Clock, Actor, Composition root and Event key keep their names: they are already the standard words, or (Event key) the alternatives each come from one broker.
- The style stays functional, in Wlaschin's sense: Zod data and pure functions, no classes.
