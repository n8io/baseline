// Reads an OpenAPI document into the commands the CLI offers: one per operation, grouped by its tag.

export type CliDocument = {
	readonly info?: {
		readonly description?: string;
		readonly title?: string;
		readonly [key: string]: unknown;
	};
	readonly paths?: Readonly<Record<string, unknown>>;
	readonly tags?: readonly {
		readonly description?: string;
		readonly name: string;
		readonly [key: string]: unknown;
	}[];
	readonly [key: string]: unknown;
};

/** How a flag's text becomes a value. */
export type CliFieldKind = "array" | "boolean" | "json" | "number" | "string";

export type CliField = {
	flag: string;
	in: "body" | "path" | "query";
	kind: CliFieldKind;
	name: string;
	required: boolean;
};

export type CliCommand = {
	body: boolean;
	description: string;
	fields: CliField[];
	group: string;
	name: string;
	operationId: string;
	query: boolean;
	summary: string;
};

type Node = Readonly<Record<string, unknown>>;

const methods = ["delete", "get", "head", "options", "patch", "post", "put"];

// Flags the CLI keeps for itself, on every command.
const reservedFlags = new Set(["data", "help", "token", "url"]);

const nodeIs = (value: unknown): value is Node =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** `invoiceLine` and `client_id` become `invoice-line` and `client-id`. */
export const cliKebab = (text: string): string =>
	text
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replaceAll("_", "-")
		.toLowerCase();

// Follows a local `$ref` (`#/components/schemas/Foo`) until it reaches a node.
const refResolve = (document: CliDocument, value: unknown): Node => {
	let node = nodeIs(value) ? value : {};
	for (let hops = 0; typeof node.$ref === "string" && hops < 20; hops++) {
		let target: unknown = document;
		for (const part of node.$ref.replace(/^#\//, "").split("/")) {
			target = nodeIs(target)
				? target[part.replaceAll("~1", "/").replaceAll("~0", "~")]
				: undefined;
		}
		node = nodeIs(target) ? target : {};
	}
	return node;
};

const kindOf = (document: CliDocument, schema: unknown): CliFieldKind => {
	const node = refResolve(document, schema);
	const type = [node.type]
		.flat()
		.find((entry) => typeof entry === "string" && entry !== "null");
	if (type === "integer" || type === "number") return "number";
	if (type === "string" || type === "boolean" || type === "array") return type;
	return "json";
};

// Path fields come first, in the order the path names them: the SDK's argument order.
const fieldsRead = ({
	document,
	operation,
	path,
	pathItem,
}: {
	document: CliDocument;
	operation: Node;
	path: string;
	pathItem: Node;
}): CliField[] => {
	const parameters = [
		...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
		...(Array.isArray(operation.parameters) ? operation.parameters : []),
	]
		.map((parameter) => refResolve(document, parameter))
		.filter(
			(parameter) =>
				typeof parameter.name === "string" &&
				(parameter.in === "path" || parameter.in === "query"),
		)
		.map(
			(parameter): CliField => ({
				flag: cliKebab(String(parameter.name)),
				in: parameter.in === "path" ? "path" : "query",
				kind: kindOf(document, parameter.schema),
				name: String(parameter.name),
				required: parameter.required === true,
			}),
		)
		.sort((a, b) => fieldPlace(path, a) - fieldPlace(path, b));
	const schema = refResolve(
		document,
		refResolve(
			document,
			refResolve(document, refResolve(document, operation.requestBody).content)[
				"application/json"
			],
		).schema,
	);
	const required = Array.isArray(schema.required) ? schema.required : [];
	const bodyFields = Object.entries(
		nodeIs(schema.properties) ? schema.properties : {},
	).map(
		([name, property]): CliField => ({
			flag: cliKebab(name),
			in: "body",
			kind: kindOf(document, property),
			name,
			required: required.includes(name),
		}),
	);
	return [...parameters, ...bodyFields];
};

const fieldPlace = (path: string, field: CliField): number =>
	field.in === "path" ? path.indexOf(`{${field.name}}`) : path.length;

const textRead = (value: unknown): string =>
	typeof value === "string" ? value : "";

/**
 * One command per operation: `<tag> <rest of operationId>` in kebab-case, so `fooCreate` under the
 * tag `foo` is `foo create`. Throws on an operation the CLI cannot name or give flags to.
 */
export const cliCommandsRead = (document: CliDocument): CliCommand[] =>
	Object.entries(document.paths ?? {}).flatMap(([path, value]) => {
		const pathItem = refResolve(document, value);
		return methods
			.filter((method) => nodeIs(pathItem[method]))
			.map((method): CliCommand => {
				const operation = refResolve(document, pathItem[method]);
				const operationId = textRead(operation.operationId);
				const tags = Array.isArray(operation.tags) ? operation.tags : [];
				const tag = textRead(tags[0]);
				const where = `${method.toUpperCase()} ${path}`;
				if (
					tags.length !== 1 ||
					tag === "" ||
					!new RegExp(`^${tag}[A-Z]`).test(operationId)
				) {
					throw new Error(
						`cliCreate: ${where} needs one tag and an operationId that starts with it (tag foo, operationId fooCreate), not tags ${JSON.stringify(tags)} and operationId "${operationId}"`,
					);
				}
				const fields = fieldsRead({ document, operation, path, pathItem });
				const flags = fields.map((field) => field.flag);
				const clash = flags.find(
					(flag, index) =>
						reservedFlags.has(flag) || flags.indexOf(flag) !== index,
				);
				if (clash !== undefined) {
					throw new Error(
						`cliCreate: ${operationId} has two fields that are both --${clash}, or one that the CLI keeps for itself (--data, --help, --token, --url); rename one`,
					);
				}
				const summary = textRead(operation.summary);
				return {
					body: operation.requestBody !== undefined,
					description: textRead(operation.description) || summary,
					fields,
					group: cliKebab(tag),
					name: cliKebab(operationId.slice(tag.length)),
					operationId,
					query: fields.some((field) => field.in === "query"),
					summary,
				};
			});
	});
