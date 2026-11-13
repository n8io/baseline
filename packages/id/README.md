# @n8io/baseline-id

Prefixed [TypeIDs](https://github.com/jetify-com/typeid) (`foo_01h455vb4pex5vsknk084sn02q`) backed by UUIDv7, and their conversion to and from a Postgres `uuid`.

```sh
pnpm add @n8io/baseline-id
```

## Exports

- `Id<P>`: the type of an id with prefix `P`, so a `bar` id never passes as a `foo` id.
- `idCreate(prefix)`: a new id with a time-ordered UUIDv7 inside.
- `idPatternCreate(prefix)`: a `RegExp` that matches only ids with exactly that prefix. Give it to your schema library to build an id schema.
- `idToUuid(id)`: the bare UUID, for a `uuid` column.
- `idFromUuid(prefix, uuid)`: the id back from a UUID.

Prefixes are snake_case. A bad prefix, id or UUID throws a `TypeError`.

## Example

```ts
import {
	type Id,
	idCreate,
	idFromUuid,
	idPatternCreate,
	idToUuid,
} from "@n8io/baseline-id";

const fooId: Id<"foo"> = idCreate("foo");
idPatternCreate("foo").test(fooId); // true

const uuid = idToUuid(fooId); // "0192…" for the database
idFromUuid("foo", uuid) === fooId; // true
```

### An id schema with Zod

The package imports no schema library, so build the schema in yours from the pattern. With Zod, as the Template's `src/id-schema.ts` does:

```ts
import { type Id, idPatternCreate } from "@n8io/baseline-id";
import { z } from "zod";

export const idSchemaCreate = <P extends string>(prefix: P): z.ZodType<Id<P>> =>
	z
		.string()
		.regex(idPatternCreate(prefix), `Expected a ${prefix} id`) as z.ZodType<
		Id<P>
	>;

const FooParams = z.object({ fooId: idSchemaCreate("foo") });
FooParams.parse({ fooId }); // { fooId: Id<"foo"> }
```

The pattern also shows up in an OpenAPI document generated from the schema.

## Needs

No peers and no env.
