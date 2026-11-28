// The CI ruleset app-create puts on a new Project's default branch, and what makes an existing one match it.
// The app-ci.yml jobs a pull request must pass: every job there but `changes`, which only reads the
// diff for the others (glossary aliases warn inside `check`).
export const requiredJobs = [
	"check",
	"unit",
	"integration",
	"browser",
	"pieces",
	"image",
	"sast",
] as const;

type Rule = { parameters?: Record<string, unknown>; type: string };
type Ruleset = {
	bypass_actors: unknown[];
	conditions: { ref_name: { exclude: string[]; include: string[] } };
	enforcement: string;
	name: string;
	rules: Rule[];
	target: string;
};

// The ruleset on the default branch, the rules baseline's own main has: no deletion, no force
// push, a pull request with squash as the only merge method and no required approvals (so a
// Dependabot merge with GITHUB_TOKEN still works), and every required app-ci.yml job as
// `ci / <job>`. No bypass actors.
export const rulesetBodyCreate = (): Ruleset => ({
	bypass_actors: [],
	conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
	enforcement: "active",
	name: "ci",
	rules: [
		{ type: "deletion" },
		{ type: "non_fast_forward" },
		{
			parameters: {
				allowed_merge_methods: ["squash"],
				dismiss_stale_reviews_on_push: false,
				require_code_owner_review: false,
				require_last_push_approval: false,
				required_approving_review_count: 0,
				required_review_thread_resolution: false,
			},
			type: "pull_request",
		},
		{
			parameters: {
				do_not_enforce_on_create: false,
				required_status_checks: requiredJobs.map((job) => ({
					context: `ci / ${job}`,
				})),
				strict_required_status_checks_policy: false,
			},
			type: "required_status_checks",
		},
	],
	target: "branch",
});

// The fields a ruleset is judged by, in a fixed order: GitHub's answer also carries ids, dates
// and defaults the body never sets, and lists rules and checks in no stable order.
// The parameters under the given keys, in key order: GitHub adds defaults the body never sets
// (required_reviewers) and answers in its own key order.
const parametersPick = ({
	keys,
	parameters,
}: {
	keys: string[];
	parameters: Record<string, unknown> | undefined;
}) =>
	Object.fromEntries(keys.toSorted().map((key) => [key, parameters?.[key]]));

const rulesetNormalize = ({
	ruleset,
	shape,
}: {
	ruleset: Partial<Ruleset>;
	shape: Ruleset;
}) => ({
	bypass_actors: ruleset.bypass_actors ?? [],
	conditions: ruleset.conditions,
	enforcement: ruleset.enforcement,
	rules: Object.fromEntries(
		((ruleset.rules ?? []) as Rule[])
			.map(({ parameters, type }): [string, unknown] => [
				type,
				type === "required_status_checks"
					? {
							checks: (
								(parameters?.["required_status_checks"] ?? []) as {
									context: string;
								}[]
							)
								.map(({ context }) => context)
								.sort(),
							create: parameters?.["do_not_enforce_on_create"],
							strict: parameters?.["strict_required_status_checks_policy"],
						}
					: parametersPick({
							keys: Object.keys(
								shape.rules.find((rule) => rule.type === type)?.parameters ??
									{},
							),
							parameters,
						}),
			])
			.sort(([a], [b]) => a.localeCompare(b)),
	),
	target: ruleset.target,
});

// What differs between the ruleset on GitHub and the wanted one, as short phrases; empty when
// they are the same.
export const rulesetChangesFind = ({
	current,
	wanted,
}: {
	current: Partial<Ruleset>;
	wanted: Ruleset;
}): string[] => {
	const have = rulesetNormalize({ ruleset: current, shape: wanted });
	const want = rulesetNormalize({ ruleset: wanted, shape: wanted });
	const changes: string[] = [];
	for (const field of [
		"bypass_actors",
		"conditions",
		"enforcement",
		"target",
	] as const) {
		if (JSON.stringify(have[field]) !== JSON.stringify(want[field]))
			changes.push(`changed ${field}`);
	}
	for (const type of new Set([
		...Object.keys(have.rules),
		...Object.keys(want.rules),
	])) {
		if (!(type in have.rules)) changes.push(`added rule ${type}`);
		else if (!(type in want.rules)) changes.push(`removed rule ${type}`);
		else if (
			JSON.stringify(have.rules[type]) !== JSON.stringify(want.rules[type])
		)
			changes.push(
				`changed rule ${type}${checksChangeDescribe(
					have.rules[type] as Checks,
					want.rules[type] as Checks,
				)}`,
			);
	}
	return changes;
};

type Checks = { checks?: string[] };

// Which required checks a change adds and removes, so an upgrade can see it only drops checks.
const checksChangeDescribe = (have: Checks, want: Checks): string => {
	const added = (want.checks ?? []).filter((c) => !have.checks?.includes(c));
	const removed = (have.checks ?? []).filter((c) => !want.checks?.includes(c));
	const named = [
		...(added.length > 0 ? [`added ${added.join(", ")}`] : []),
		...(removed.length > 0 ? [`removed ${removed.join(", ")}`] : []),
	];
	return named.length > 0 ? ` (${named.join("; ")})` : "";
};

type Gh = (args: string[], input?: string | undefined) => string;

// Makes the ruleset named ci match rulesetBodyCreate(): creates it when missing, updates it when
// it differs (and says what changed), and makes no write when it already matches.
export const rulesetReconcile = ({
	gh,
	repository,
}: {
	gh: Gh;
	repository: string;
}): string => {
	const wanted = rulesetBodyCreate();
	const path = `repos/${repository}/rulesets`;
	const listed = JSON.parse(gh(["api", `${path}?includes_parents=false`])) as {
		id: number;
		name: string;
	}[];
	const found = listed.find(({ name }) => name === wanted.name);
	if (found === undefined) {
		gh(
			["api", "--method", "POST", path, "--input", "-"],
			JSON.stringify(wanted),
		);
		return `Created the ${wanted.name} ruleset on ${repository}`;
	}
	const current = JSON.parse(gh(["api", `${path}/${found.id}`])) as Ruleset;
	const changes = rulesetChangesFind({ current, wanted });
	if (changes.length === 0)
		return `${repository} already has the ${wanted.name} ruleset as wanted`;
	gh(
		["api", "--method", "PUT", `${path}/${found.id}`, "--input", "-"],
		JSON.stringify(wanted),
	);
	return `Updated the ${wanted.name} ruleset on ${repository}: ${changes.join(", ")}`;
};
