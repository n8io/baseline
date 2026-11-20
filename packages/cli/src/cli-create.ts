import { readFile } from "node:fs/promises";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import {
	type CliCommand,
	type CliDocument,
	type CliField,
	cliCommandsRead,
	cliKebab,
} from "./cli-commands-read.ts";
import { cliEnvPrefix, cliLoginRun, cliLoginTokenRead } from "./cli-login.ts";

/** What an SDK function resolves to: the HTTP status and the parsed body. */
export type CliOperationResponse = { data?: unknown; status: number };

/**
 * The last argument the CLI passes to every SDK function: the base URL, and the bearer token
 * when there is one.
 */
export type CliRequest = { baseUrl: string; token?: string };

/**
 * An SDK function. The CLI calls it with the path fields in path order, then the body if the
 * operation has one, then the query object if it has query fields, then a `CliRequest`.
 */
export type CliOperation = (...args: never[]) => unknown;

export type Cli = {
	/** Runs one command from its arguments (`process.argv.slice(2)`), and sets `process.exitCode`. */
	run: (argv: readonly string[]) => Promise<void>;
};

type Options = Record<string, unknown>;

// The key commander stores a flag's value under: `--customer-id` is `customerId`.
const attributeOf = (field: CliField): string =>
	field.flag.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());

const valueRead = (kind: CliField["kind"] | undefined, value: string) => {
	if (kind === "number") {
		const parsed = Number(value);
		if (Number.isNaN(parsed)) {
			throw new InvalidArgumentError(`${value} is not a number.`);
		}
		return parsed;
	}
	if (kind !== "json") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
};

// A value outside the schema's `enum` fails here, before any request.
const choiceCheck = (field: CliField, value: string): string => {
	const kind = field.kind === "array" ? field.itemKind : field.kind;
	// `--level 01` is the number 1.
	const text = kind === "number" ? String(Number(value)) : value;
	if (field.choices !== undefined && !field.choices.includes(text)) {
		throw new InvalidArgumentError(
			`Allowed choices are ${field.choices.join(", ")}.`,
		);
	}
	return value;
};

const valueParse = (field: CliField) => (value: string, previous: unknown) =>
	field.kind === "array"
		? [
				...(Array.isArray(previous) ? previous : []),
				valueRead(field.itemKind, choiceCheck(field, value)),
			]
		: valueRead(field.kind, choiceCheck(field, value));

// `sort (query): the order (choices: name, -name) (default: -name)`.
const helpOf = (field: CliField): string =>
	[
		`${field.name} (${field.in}${field.required ? ", required" : ""})${field.description === undefined ? "" : `: ${field.description.replace(/\s+/g, " ").trim()}`}`,
		...(field.choices === undefined
			? []
			: [`(choices: ${field.choices.join(", ")})`]),
		...(field.default === undefined
			? []
			: [
					`(default: ${typeof field.default === "string" ? field.default : JSON.stringify(field.default)})`,
				]),
	].join(" ");

const optionAdd = (command: Command, field: CliField): void => {
	const flags =
		field.kind === "boolean"
			? `--${field.flag}`
			: `--${field.flag} <${field.kind === "array" ? "values..." : "value"}>`;
	const description = helpOf(field);
	if (field.kind === "boolean") {
		command.option(flags, description).option(`--no-${field.flag}`);
	} else if (field.in === "path") {
		command.requiredOption(flags, description, valueParse(field));
	} else {
		command.option(flags, description, valueParse(field));
	}
};

// `--data @file.json` reads the file; `--data '<json>'` parses the text.
const dataRead = async (data: unknown): Promise<unknown> => {
	if (typeof data !== "string") return undefined;
	const json = data.startsWith("@")
		? await readFile(data.slice(1), "utf8")
		: data;
	return JSON.parse(json);
};

const argsBuild = async ({
	command,
	options,
}: {
	command: CliCommand;
	options: Options;
}): Promise<unknown[]> => {
	const picked = (where: CliField["in"]): Options =>
		Object.fromEntries(
			command.fields
				.filter(
					(field) =>
						field.in === where && options[attributeOf(field)] !== undefined,
				)
				.map((field) => [field.name, options[attributeOf(field)]]),
		);
	const fromData = await dataRead(options.data);
	const bodyFields = picked("body");
	const flagged = Object.keys(bodyFields).length > 0;
	const dataIsObject =
		typeof fromData === "object" &&
		fromData !== null &&
		!Array.isArray(fromData);
	if (flagged && fromData !== undefined && !dataIsObject) {
		throw new Error(
			"--data is not a JSON object, so body flags cannot add to it.",
		);
	}
	// A body that is not an object (an array, a string) goes as --data gave it.
	const body =
		flagged || dataIsObject
			? { ...(fromData as Options), ...bodyFields }
			: fromData;
	const query = picked("query");
	return [
		...Object.values(picked("path")),
		...(command.body ? [body] : []),
		...(command.query
			? [Object.keys(query).length === 0 ? undefined : query]
			: []),
	];
};

const responsePrint = (response: unknown): void => {
	const { data, status } = (response ?? {}) as Partial<CliOperationResponse>;
	if (typeof status !== "number" || status >= 400) {
		const problem = (data ?? {}) as Options;
		const reason =
			typeof problem.title === "string"
				? [problem.title, problem.code].filter(Boolean).join(": ")
				: `HTTP ${status} ${JSON.stringify(data ?? null)}`;
		process.stderr.write(`${reason}\n`);
		process.exitCode = 1;
		return;
	}
	if (data !== undefined && data !== null && data !== "") {
		process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
	}
};

// The environments the document lists in `servers`: each `description` names one absolute URL.
// A relative or templated server URL (`/`, `https://{region}.acme.dev`) names none.
const environmentsRead = (document: CliDocument): Map<string, string> =>
	new Map(
		(document.servers ?? []).flatMap(({ description, url }) =>
			description === undefined || !URL.canParse(url) || url.includes("{")
				? []
				: [[description, url]],
		),
	);

const environmentNames = (document: CliDocument): string =>
	[...environmentsRead(document).keys()].join(", ") || "none: use a URL";

// The base URL: --url, else --env, else <NAME>_URL, else <NAME>_ENV. A flag beats an env var,
// and at each level a URL overrides an environment.
const urlRead = ({
	document,
	name,
	options,
}: {
	document: CliDocument;
	name: string;
	options: Options;
}): string => {
	const prefix = cliEnvPrefix(name);
	// An empty flag (`--env "$UNSET"`) is an error, not a fall through to the env vars.
	const [kind, value] =
		(
			[
				["url", options.url],
				["env", options.env],
				["url", process.env[`${prefix}_URL`] || undefined],
				["env", process.env[`${prefix}_ENV`] || undefined],
			] as const
		).find(([, given]) => typeof given === "string") ?? [];
	if (value === "") throw new Error(`--${kind} needs a value.`);
	if (typeof value !== "string") {
		throw new Error(
			`Pick an environment with --env or ${prefix}_ENV (${environmentNames(document)}), or set a URL with --url or ${prefix}_URL.`,
		);
	}
	const url = kind === "url" ? value : environmentsRead(document).get(value);
	if (url === undefined) {
		throw new Error(
			`No environment ${value}: pick one of ${environmentNames(document)}.`,
		);
	}
	return url.replace(/\/+$/, "");
};

const tokenRead = async ({
	name,
	options,
	url,
}: {
	name: string;
	options: Options;
	url: string;
}): Promise<string | undefined> => {
	const fromEnv = process.env[`${cliEnvPrefix(name)}_TOKEN`];
	if (typeof options.token === "string") return options.token;
	if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
	return cliLoginTokenRead({ name, url });
};

const loginAdd = ({
	document,
	name,
	program,
}: {
	document: CliDocument;
	name: string;
	program: Command;
}) => {
	program
		.command("login")
		.description(
			`Sign in a machine client and store its token. The client secret comes from ${cliEnvPrefix(name)}_CLIENT_SECRET or stdin.`,
		)
		.requiredOption("--client-id <id>", "the machine client's id")
		.configureHelp({ showGlobalOptions: true })
		.option("--scope <scopes...>", "scopes to ask for (default all)")
		.action(async (_options: Options, command: Command) => {
			const options = command.optsWithGlobals<Options>();
			const result = await cliLoginRun({
				clientId: String(options.clientId),
				name,
				scopes: Array.isArray(options.scope) ? options.scope.map(String) : null,
				url: urlRead({ document, name, options }),
			});
			if ("error" in result) {
				process.stderr.write(`${result.error}\n`);
				process.exitCode = 1;
				return;
			}
			process.stderr.write(`Logged in. The token is in ${result.path}\n`);
		});
};

// One command per operation, plus `login`. A fresh one per run: commander keeps parsed options.
const programCreate = ({
	commands,
	document,
	name,
	operations,
}: {
	commands: CliCommand[];
	document: CliDocument;
	name: string;
	operations: Readonly<Record<string, CliOperation>>;
}): Command => {
	const prefix = cliEnvPrefix(name);
	const program = new Command(name)
		.description(document.info?.description || document.info?.title || name)
		.option(
			"--env <name>",
			`the environment (default ${prefix}_ENV): ${environmentNames(document)}`,
		)
		.option(
			"--url <url>",
			`a base URL that beats --env, for tests and one-off servers (default ${prefix}_URL, which --env beats)`,
		)
		.option(
			"--token <token>",
			`the bearer token (default ${prefix}_TOKEN, then the stored login)`,
		)
		.exitOverride();
	const groups = new Map<string, Command>();
	for (const command of commands) {
		const group =
			groups.get(command.group) ??
			program
				.command(command.group)
				.description(
					document.tags?.find((tag) => cliKebab(tag.name) === command.group)
						?.description ?? "",
				);
		groups.set(command.group, group);
		const sub = group
			.command(command.name)
			.summary(command.summary)
			.description(command.description);
		for (const field of command.fields) optionAdd(sub, field);
		if (command.body) {
			sub.option("--data <json>", "the body as JSON, or @file.json");
		}
		sub.action(async (_options: Options, self: Command) => {
			const options = self.optsWithGlobals<Options>();
			const url = urlRead({ document, name, options });
			const token = await tokenRead({ name, options, url });
			const operation = operations[command.operationId] as unknown as (
				...args: unknown[]
			) => Promise<unknown>;
			const request: CliRequest =
				token === undefined ? { baseUrl: url } : { baseUrl: url, token };
			responsePrint(
				await operation(...(await argsBuild({ command, options })), request),
			);
		});
	}
	for (const [group, command] of groups) {
		if (command.description() === "") {
			command.description(
				commands
					.filter((entry) => entry.group === group)
					.map((entry) => entry.name)
					.join(", "),
			);
		}
	}
	loginAdd({ document, name, program });
	return program;
};

/**
 * A command line client for an API: one command per operation in `document`, grouped by tag
 * (`fooCreate` under the tag `foo` is `<name> foo create`), each calling the SDK function in
 * `operations` with the same operationId. Body, path and query fields are kebab-case flags;
 * `--data` sends a body from JSON or `@file.json`. `--env` or `<NAME>_ENV` picks an environment
 * from the document's `servers` (by `description`); `--url` or `<NAME>_URL` overrides it. The
 * token is `--token`, else `<NAME>_TOKEN`, else the one `<name> login` stored. A response
 * prints its JSON to stdout; a Problem prints its title and code to stderr and exits 1.
 */
export const cliCreate = ({
	document,
	name,
	operations,
}: {
	document: CliDocument;
	name: string;
	operations: Readonly<Record<string, CliOperation>>;
}): Cli => {
	const commands = cliCommandsRead(document);
	const missing = commands.find(
		({ operationId }) => typeof operations[operationId] !== "function",
	);
	if (missing !== undefined) {
		throw new Error(
			`cliCreate: operations has no ${missing.operationId}; regenerate the SDK from this document`,
		);
	}
	return {
		run: async (argv) => {
			const program = programCreate({ commands, document, name, operations });
			try {
				await program.parseAsync([...argv], { from: "user" });
			} catch (error) {
				if (error instanceof CommanderError) {
					process.exitCode = error.exitCode;
					return;
				}
				process.stderr.write(
					`${error instanceof Error ? error.message : String(error)}\n`,
				);
				process.exitCode = 1;
			}
		},
	};
};
