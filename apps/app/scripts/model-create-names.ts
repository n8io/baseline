import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { kebabPattern } from "./model-create-foo.ts";
import { lineIsFoo, type NameForms } from "./template-render.ts";

// Names

// The glossary term a name needs: invoice-line ↔ **Invoice line**:.
export const nameTerm = (kebab: string): string => {
	const words = kebab.replaceAll("-", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
};

// The reason a Model name is refused for its form or for lacking an entry in its context's
// glossary, or undefined when it is fine.
export const nameRefusal = ({
	appDirectory,
	context,
	kebab,
}: {
	appDirectory: string;
	context: string;
	kebab: string;
}): string | undefined => {
	if (!kebabPattern.test(kebab)) return `"${kebab}" is not kebab-case`;
	if (lineIsFoo(kebab))
		return `"${kebab}" names foo, the Template's example name, which the render renames`;
	const term = nameTerm(kebab);
	const path = `src/contexts/${context}/CONTEXT.md`;
	const file = join(appDirectory, path);
	const glossary = existsSync(file) ? readFileSync(file, "utf8") : "";
	if (!glossary.toLowerCase().includes(`**${term.toLowerCase()}**:`)) {
		return `${path} has no **${term}**: entry; agree the term and add it first`;
	}
	return undefined;
};

// The reason model-create refuses this Model in this context, or undefined.
export const modelRefusal = ({
	model,
	appDirectory,
	context,
}: {
	model: NameForms;
	appDirectory: string;
	context: string;
}): string | undefined => {
	if (!kebabPattern.test(context)) return `"${context}" is not kebab-case`;
	if (!existsSync(join(appDirectory, "src/contexts", context, "index.ts"))) {
		return `no src/contexts/${context}/; make it with pnpm context-create ${context}`;
	}
	for (const name of [model.kebab, model.plural]) {
		if (!kebabPattern.test(name)) return `"${name}" is not kebab-case`;
	}
	// /api/v1/docs belongs to the API reference page and skips the sign-in guard.
	if (model.plural === "docs") {
		return '"docs" is the API reference page\'s path';
	}
	if (model.plural === model.kebab) {
		return "the plural must differ from the name";
	}
	// A Model's names (its routes, scopes, ids and Use cases) are the app's, not only its
	// context's: no other context may hold it, nor be named after it.
	const contexts = join(appDirectory, "src/contexts");
	for (const other of existsSync(contexts) ? readdirSync(contexts) : []) {
		const modelFile = `src/contexts/${other}/domain/${model.kebab}.ts`;
		if (existsSync(join(appDirectory, modelFile)))
			return `${modelFile} already exists`;
	}
	if (model.kebab !== context && existsSync(join(contexts, model.kebab))) {
		return `src/contexts/${model.kebab}/ is another context; name the Model otherwise`;
	}
	return nameRefusal({ appDirectory, context, kebab: model.kebab });
};

// The contexts a context already reads, from its ACL files: <context>-<upstream>-acl.ts.
export const contextReadsFind = ({
	appDirectory,
	context,
}: {
	appDirectory: string;
	context: string;
}): string[] => {
	const folder = join(
		appDirectory,
		"src/contexts",
		context,
		"adapters/outbound",
	);
	if (!existsSync(folder)) return [];
	return readdirSync(folder)
		.flatMap((name) => {
			const upstream = name.startsWith(`${context}-`)
				? /^(.+)-acl\.ts$/.exec(name.slice(context.length + 1))?.[1]
				: undefined;
			return upstream === undefined ? [] : [upstream];
		})
		.sort();
};
