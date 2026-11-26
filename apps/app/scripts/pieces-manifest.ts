// Edits to a Project's package.json and dependencies-allowed.json, and the packages it lists.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { type Piece, pieces } from "./pieces-names.ts";

export const textEdit = ({
	directory,
	edit,
	path,
}: {
	directory: string;
	edit: (text: string) => string;
	path: string;
}) => {
	const file = join(directory, path);
	if (!existsSync(file)) return;
	const text = readFileSync(file, "utf8");
	const edited = edit(text);
	if (edited !== text) writeFileSync(file, edited);
};

const recordSchema = z.record(z.string(), z.string());
// Loose: a package.json keeps every field it has that the edits do not name.
const manifestSchema = z.looseObject({
	dependencies: recordSchema.optional(),
	devDependencies: recordSchema.optional(),
	imports: recordSchema.optional(),
	scripts: z.record(z.string(), z.string().optional()).default({}),
});
export type Manifest = z.infer<typeof manifestSchema>;

// The JSON checked against the schema, in the file's own key order (a schema parse reorders keys
// by its shape), so an edited file diffs only where it changed.
export const objectParse = <Shape extends z.ZodRawShape>(
	schema: z.ZodObject<Shape, z.core.$loose>,
	text: string,
) => {
	const original: unknown = JSON.parse(text);
	const parsed = schema.parse(original);
	return typeof original === "object" && original !== null
		? { ...original, ...parsed }
		: parsed;
};

// The record without the named keys; a missing record stays missing.
export const recordOmit = <Value>(
	record: Record<string, Value> | undefined,
	names: readonly string[],
): Record<string, Value> | undefined =>
	record &&
	Object.fromEntries(
		Object.entries(record).filter(([name]) => !names.includes(name)),
	);

export const manifestEdit = (
	directory: string,
	edit: (m: Manifest) => Manifest,
) =>
	textEdit({
		directory,
		path: "package.json",
		edit: (text) => {
			const manifest = objectParse(manifestSchema, text);
			return `${JSON.stringify(edit(manifest), null, "\t")}\n`;
		},
	});

// dependencies-allowed.json lists the Project's runtime dependencies, so a removed package leaves it too.
const dependenciesAllowedEdit = (
	directory: string,
	edit: (allowed: Record<string, string>) => Record<string, string>,
) =>
	textEdit({
		directory,
		path: "dependencies-allowed.json",
		edit: (text) =>
			`${JSON.stringify(edit(recordSchema.parse(JSON.parse(text))), null, "\t")}\n`,
	});

// Drops the Piece's packages; without the UI, Hono serves itself through @hono/node-server.
export const dependenciesAllowedPieceRemove = (
	directory: string,
	piece: Piece,
) =>
	dependenciesAllowedEdit(directory, (allowed) => {
		const kept = recordOmit(allowed, pieces[piece].packages) ?? {};
		if (piece !== "ui") return kept;
		return Object.fromEntries(
			Object.entries({
				...kept,
				"@hono/node-server": "serves Hono on Node",
			}).toSorted(([a], [b]) => (a < b ? -1 : 1)),
		);
	});

export const packagesInstalled = (directory: string): Set<string> => {
	const manifest = objectParse(
		manifestSchema,
		readFileSync(join(directory, "package.json"), "utf8"),
	);
	return new Set(
		Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }),
	);
};
