// A foo and its tags form one aggregate. Tags have no repository of their own.
export type Foo = { id: string; name: string; tags: readonly string[] };
export type FooCreateInput = { name: string; tags: readonly string[] };
