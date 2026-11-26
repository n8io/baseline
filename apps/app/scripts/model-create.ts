// pnpm model-create <context> <model> [--plural <p>] [--bare] [options]: copies Foo, the
// Template's Model, into an existing context under a new name, and wires it in at every
// `wiring:` marker, in the context's own files and in the entry points. --bare copies only
// Foo's core and the options named. Writes no migration and never commits. pnpm context-create makes
// the context first; `pnpm model-create --help` lists the options.

export { modelFilesCreate } from "./model-create-build.ts";
export {
	barRemove,
	blocksOf,
	contextFilePaths,
	contextModelPathRename,
	contextModelRename,
	kebabPattern,
	lineIsBar,
	lineIsModel,
} from "./model-create-foo.ts";
export {
	contextReadsFind,
	modelRefusal,
	nameRefusal,
	nameTerm,
} from "./model-create-names.ts";
export {
	type ModelOption,
	modelOptions,
	optionsApply,
	templateWithoutPieces,
	wiringOptionOf,
} from "./model-create-options.ts";
export { aclPath, readsApply, readsRefusal } from "./model-create-reads.ts";
export {
	filesFormat,
	filesWriteAll,
	modelChecksRun,
	modelNextStepsText,
	modelOptionsRefusal,
	optionsAvailableFind,
	templateOf,
} from "./model-create-run.ts";
export {
	contextsPairsFill,
	fileHasEmptyFillablePair,
	type PairWanted,
	pairOptionOf,
	wiringInsert,
} from "./model-create-wiring.ts";

import { argsFail, argsParse, argsUsageFail } from "./args.ts";
import { modelFilesCreate } from "./model-create-build.ts";
import { modelRefusal } from "./model-create-names.ts";
import { modelOptions } from "./model-create-options.ts";
import {
	filesFormat,
	filesWriteAll,
	modelChecksRun,
	modelMigrationHas,
	modelNextStepsText,
	modelOptionsRefusal,
	optionsAvailableFind,
	templateOf,
} from "./model-create-run.ts";
import type { NameForms, TemplateFile } from "./template-render.ts";

const usage = `Usage: pnpm model-create <context> <model> [--plural <plural>] [--bare] [options]

Copies Foo, the Template's Model, into src/contexts/<context>/ as <model>, and wires it
into the context's files, the Server, the Worker and the UI. Make the context first with
pnpm context-create, and add <model>'s **Term**: entry to its CONTEXT.md.

  --plural <plural>  the plural, when it is not <model>s
  --bare             only the core: the Model, its errors, create/get/list/update/delete, the
                     API, the repository (memory, Postgres, contract test), created and deleted
                     Events. Without --bare every option below is copied.
  --analytics        with --bare: track the created Event
  --cache            with --bare: a read-through cache on get
  --live             with --bare: live updates to pages
  --pages            with --bare: list and detail pages
  --schedule         with --bare: the stale-archive Schedule and its Use case
  --seed             with --bare: development rows
  -h, --help         this help

Never generated: business model functions, Event handlers, sagas. See docs/agents/context-create.md.`;

const flags = {
	analytics: { type: "boolean" },
	bare: { type: "boolean" },
	cache: { type: "boolean" },
	live: { type: "boolean" },
	pages: { type: "boolean" },
	plural: { type: "string" },
	schedule: { type: "boolean" },
	seed: { type: "boolean" },
} as const;

const main = () => {
	const parsed = argsParse({ allowPositionals: true, options: flags, usage });
	if (parsed === undefined) return;
	const { positionals, values } = parsed;
	const [context, kebab] = positionals;
	if (
		context === undefined ||
		kebab === undefined ||
		positionals.length !== 2
	) {
		argsUsageFail(usage);
		return;
	}
	const named = modelOptions.filter((option) => values[option] === true);
	if (!values.bare && named.length > 0) {
		argsFail(
			"model-create",
			`--${named.join(", --")} picks options for --bare; without --bare every option is copied`,
		);
		return;
	}
	const options = values.bare ? named : null;
	const model: NameForms = {
		kebab,
		plural: values.plural ?? `${kebab}s`,
	};
	const appDirectory = process.cwd();
	const refusal =
		modelRefusal({ model, appDirectory, context }) ??
		modelOptionsRefusal({ appDirectory, options: named });
	if (refusal !== undefined) {
		argsFail("model-create", refusal);
		return;
	}
	let files: TemplateFile[] = [];
	try {
		files = modelFilesCreate({
			model,
			appDirectory,
			context,
			options,
			templateFull: templateOf(appDirectory),
		});
	} catch (error) {
		argsFail("model-create", (error as Error).message);
		return;
	}
	const wired = filesWriteAll({ appDirectory, files });
	console.log(
		`Wrote ${model.kebab} into src/contexts/${context}/ and wired it into ${wired} files; running pnpm check and pnpm test.`,
	);
	filesFormat({ appDirectory, paths: files.map((f) => f.path) });
	const checksFailure = modelChecksRun({
		appDirectory,
		command: "model-create",
	});
	if (checksFailure !== undefined) {
		console.error(checksFailure);
		process.exitCode = 1;
		return;
	}
	console.log(
		`Created ${model.kebab}; pnpm check and pnpm test pass.\n${modelNextStepsText(
			{
				model,
				context,
				migrated: modelMigrationHas({ model, appDirectory, context }),
				options: options ?? optionsAvailableFind(appDirectory),
			},
		)}`,
	);
};

if (import.meta.main) main();
