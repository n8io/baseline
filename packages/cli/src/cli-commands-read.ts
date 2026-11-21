// Reads an OpenAPI document into the commands the CLI offers: one per operation, grouped by its tag.

/** The parts of an OpenAPI document the CLI reads. */
export type CliDocument = {
	readonly info?: {
		readonly description?: string;
		readonly title?: string;
		readonly [key: string]: unknown;
	};
	readonly paths?: Readonly<Record<string, unknown>>;
	/** The API's environments: `description` is the environment's name, `url` its base URL. */
	readonly servers?: readonly {
		readonly description?: string;
		readonly url: string;
		readonly [key: string]: unknown;
	}[];
	readonly tags?: readonly {
		readonly description?: string;
		readonly name: string;
		readonly [key: string]: unknown;
	}[];
	readonly [key: string]: unknown;
};

/** How a flag's text becomes a value. */
type CliFieldKind = "array" | "boolean" | "json" | "number" | "string";

/** One flag of a command: a path, query or body field. */
export type CliField = {
	/** The values the schema allows (its `enum`), as text; for an array, its items' values. */
	choices?: string[];
	/** The schema's `default`, shown in the help; the CLI does not send it. */
	default?: unknown;
	/** The parameter's or schema's `description`. */
	description?: string;
	flag: string;
	in: "body" | "path" | "query";
	/** An array's item kind. */
	itemKind?: CliFieldKind;
	kind: CliFieldKind;
	name: string;
	required: boolean;
};

/** One command, read from one operation. */
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
const reservedFlags = new Set(["data", "env", "help", "token", "url"]);

// Top-level commands the CLI keeps for itself.
const reservedCommands = new Set(["help", "login"]);

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

// The one non-null type a schema allows, looking through `anyOf` and `oneOf` (Zod's nullable).
const typeOf = (document: CliDocument, schema: Node): unknown => {
	const types = new Set(
		[
			schema.type,
			...[schema.anyOf, schema.oneOf]
				.flatMap((members) => (Array.isArray(members) ? members : []))
				.map((member) => refResolve(document, member).type),
		]
			.flat()
			.filter((type) => typeof type === "string" && type !== "null"),
	);
	if (types.size === 0 && Array.isArray(schema.enum)) {
		return schema.enum.every((value) => typeof value === "string")
			? "string"
			: undefined;
	}
	return types.size === 1 ? [...types][0] : undefined;
};

const kindOf = (document: CliDocument, node: Node): CliFieldKind => {
	const type = typeOf(document, node);
	if (type === "array") return "array";
	if (type === "integer" || type === "number") return "number";
	if (type === "string" || type === "boolean") return type;
	return "json";
};

// A schema and the members of its `anyOf` and `oneOf` (Zod's nullable), resolved.
const membersOf = (document: CliDocument, node: Node): Node[] => [
	node,
	...[node.anyOf, node.oneOf]
		.flatMap((members) => (Array.isArray(members) ? members : []))
		.map((member) => refResolve(document, member)),
];

// The `enum` of a schema, as the text a flag takes, without the null a nullable adds.
const choicesOf = (document: CliDocument, node: Node): string[] | undefined => {
	const values = membersOf(document, node)
		.flatMap((member) => (Array.isArray(member.enum) ? member.enum : []))
		.filter((value) => value !== null)
		.map((value) =>
			typeof value === "string" ? value : JSON.stringify(value),
		);
	return values.length === 0 ? undefined : [...new Set(values)];
};

// The first non-empty text of `key` on the schema as written, then on what its `$ref` names.
const siblingRead = (nodes: Node[], key: "default" | "description") =>
	nodes
		.map((node) => node[key])
		.find((value) =>
			key === "default"
				? value !== undefined
				: typeof value === "string" && value !== "",
		);

// How a field's flag reads and describes its value: kind, allowed values, default and description.
const schemaRead = (
	document: CliDocument,
	schema: unknown,
): Pick<
	CliField,
	"choices" | "default" | "description" | "itemKind" | "kind"
> => {
	const node = refResolve(document, schema);
	const kind = kindOf(document, node);
	// OpenAPI 3.1 lets `default` and `description` sit beside a `$ref`; those win.
	const written = nodeIs(schema) ? [schema, node] : [node];
	const fallback = siblingRead(written, "default");
	const description = siblingRead(written, "description");
	// A nullable array keeps its `items` in the non-null member.
	const items = refResolve(
		document,
		membersOf(document, node).find((member) => member.items !== undefined)
			?.items,
	);
	// A boolean is a switch, so its values are not listed.
	const choices =
		kind === "boolean"
			? undefined
			: choicesOf(document, kind === "array" ? items : node);
	return {
		...(choices === undefined ? {} : { choices }),
		...(fallback === undefined ? {} : { default: fallback }),
		...(typeof description === "string" ? { description } : {}),
		...(kind === "array" ? { itemKind: kindOf(document, items) } : {}),
		kind,
	};
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
	// An operation's parameter replaces the path item's one with the same `in` and name.
	const parameters = [
		...new Map(
			[
				...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
				...(Array.isArray(operation.parameters) ? operation.parameters : []),
			]
				.map((parameter) => refResolve(document, parameter))
				.map((parameter) => [`${parameter.in} ${parameter.name}`, parameter]),
		).values(),
	];
	const other = parameters.find(
		(parameter) => parameter.in !== "path" && parameter.in !== "query",
	);
	if (other !== undefined) {
		throw new TypeError(
			`cliCreate: document ${String(operation.operationId)} has a ${String(other.in)} parameter, ${String(other.name)}; the CLI sends only path, query and body fields`,
		);
	}
	const parameterFields = parameters
		.map(
			(parameter): CliField => ({
				flag: cliKebab(String(parameter.name)),
				in: parameter.in === "path" ? "path" : "query",
				// A path parameter without a schema is still text.
				...(parameter.schema === undefined && parameter.in === "path"
					? { kind: "string" }
					: schemaRead(document, parameter.schema)),
				// The parameter's own description wins over its schema's.
				...(typeof parameter.description === "string" &&
				parameter.description !== ""
					? { description: parameter.description }
					: {}),
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
			...schemaRead(document, property),
			name,
			required: required.includes(name),
		}),
	);
	return [...parameterFields, ...bodyFields];
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
					throw new TypeError(
						`cliCreate: document ${where} needs one tag and an operationId that starts with it (tag foo, operationId fooCreate), not tags ${JSON.stringify(tags)} and operationId "${operationId}"`,
					);
				}
				const group = cliKebab(tag);
				const name = cliKebab(operationId.slice(tag.length));
				if (reservedCommands.has(group) || name === "help") {
					throw new TypeError(
						`cliCreate: document ${operationId} would be the command "${group} ${name}", but the CLI keeps login and help for itself; rename its tag or operationId`,
					);
				}
				const fields = fieldsRead({ document, operation, path, pathItem });
				const flags = fields.map((field) => field.flag);
				const clash = flags.find(
					(flag, index) =>
						reservedFlags.has(flag) || flags.indexOf(flag) !== index,
				);
				if (clash !== undefined) {
					throw new TypeError(
						`cliCreate: document ${operationId} has two fields that are both --${clash}, or one that the CLI keeps for itself (--data, --env, --help, --token, --url); rename one`,
					);
				}
				const summary = textRead(operation.summary);
				return {
					body: operation.requestBody !== undefined,
					description: textRead(operation.description) || summary,
					fields,
					group,
					name,
					operationId,
					query: fields.some((field) => field.in === "query"),
					summary,
				};
			});
	});
