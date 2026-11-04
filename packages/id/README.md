# @n8io/baseline-id

Prefixed [TypeIDs](https://github.com/jetify-com/typeid) (`foo_01h455vb4pex5vsknk084sn02q`) backed by UUIDv7, and their conversion to and from a Postgres `uuid`.

```sh
pnpm add @n8io/baseline-id
```

## Exports

- `Id<P>`: the type of an id with prefix `P`, so a `bar` id never passes as a `foo` id.
- `idCreate(prefix)`: a new id with a time-ordered UUIDv7 inside.
- `idSchema(prefix)`: a Zod schema that accepts only ids with exactly that prefix.
- `idToUuid(id)`: the bare UUID, for a `uuid` column.
- `idFromUuid(prefix, uuid)`: the id back from a UUID.

Prefixes are snake_case. A bad prefix, id or UUID throws a `TypeError`.

## Example

```ts
import {
	type Id,
	idCreate,
	idFromUuid,
	idSchema,
	idToUuid,
} from "@n8io/baseline-id";

const fooId: Id<"foo"> = idCreate("foo");
const FooParams = z.object({ fooId: idSchema("foo") });

const uuid = idToUuid(fooId); // "0192…" for the database
idFromUuid("foo", uuid) === fooId; // true
```

## Needs

Peer: `zod`. No env.
