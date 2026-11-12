import type { FooPorts } from "../ports.ts";
import { fooCreate } from "./foo-create.ts";
import { fooDelete } from "./foo-delete.ts";
import { fooGet } from "./foo-get.ts";
import { fooList } from "./foo-list.ts";
import { fooStaleArchive } from "./foo-stale-archive.ts";
import { fooUpdate } from "./foo-update.ts";

export const fooUseCasesCreate = (ports: FooPorts) => ({
	fooCreate: fooCreate(ports),
	fooDelete: fooDelete(ports),
	fooGet: fooGet(ports),
	fooList: fooList(ports),
	fooStaleArchive: fooStaleArchive(ports),
	fooUpdate: fooUpdate(ports),
});

export type FooUseCases = ReturnType<typeof fooUseCasesCreate>;
