import { barCreate } from "./bar-create.ts";
import { barList } from "./bar-list.ts";
import { fooCreate } from "./foo-create.ts";
import { fooDelete } from "./foo-delete.ts";
import { fooGet } from "./foo-get.ts";
import { fooList } from "./foo-list.ts";
import { fooStaleArchive } from "./foo-stale-archive.ts";
import { fooUpdate } from "./foo-update.ts";
import type { FooPorts } from "./ports.ts";

export const fooUseCasesCreate = (ports: FooPorts) => ({
	barCreate: barCreate(ports),
	barList: barList(ports),
	fooCreate: fooCreate(ports),
	fooDelete: fooDelete(ports),
	fooGet: fooGet(ports),
	fooList: fooList(ports),
	// aggregate-create-start: schedule
	fooStaleArchive: fooStaleArchive(ports),
	// aggregate-create-end: schedule
	fooUpdate: fooUpdate(ports),
	// wiring: use-cases
});

export type FooUseCases = ReturnType<typeof fooUseCasesCreate>;
