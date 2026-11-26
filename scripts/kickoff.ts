// Maintainer script: part of baseline's own agent workflow, never rendered into a Project.
// Prints the kickoff for a ticket thread, so the standing text is never retyped.
// Usage: node scripts/kickoff.ts <issue number> --title <title> [--repo owner/name] [--context <path>]
//   [--owns <files>] [--gates <text>] [--size <lines>]
import { parseArgs } from "node:util";

export type KickoffInput = {
	context: string | null;
	gates: string;
	issue: number;
	owns: string | null;
	repo: string;
	size: number;
	title: string;
};

// The model rule is Nate's, set 2026-11-20: cheapest model that does the step well, never Fable.
export const kickoffWrite = (input: KickoffInput): string =>
	[
		"You are a ticket worker. Invoke the ticket-worker skill and follow it.",
		`Issue: ${input.repo}#${input.issue} "${input.title}". Already claimed. The issue body is the full ticket, including acceptance.`,
		input.context
			? `Context pack: ${input.context} (read all of it).`
			: "Context pack: none; the issue body and the repository's AGENTS.md are enough.",
		"Model: Haiku for search and mechanical edits, Sonnet for the work and one review of the diff, Opus only for a genuinely hard call. Never Fable. Apply this to every subagent.",
		input.owns ? `Owns: ${input.owns}.` : null,
		`Size budget: about ${input.size} changed non-generated lines; over that, stop and propose a split.`,
		`Gates: ${input.gates}. Run \`pnpm pre-pr\` before opening the pull request. Never skip or bypass a check. Squash merge once CI is green, or turn on auto-merge.`,
		"Finish: reply in your thread with the pull request link, what changed and CI rounds.",
	]
		.filter((line): line is string => line !== null)
		.join("\n");

if (import.meta.main) {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: {
			context: { type: "string" },
			gates: {
				default: "pnpm check and the tests pass, CI fully green",
				type: "string",
			},
			owns: { type: "string" },
			repo: { default: "n8io/baseline", type: "string" },
			size: { default: "1500", type: "string" },
			title: { type: "string" },
		},
	});
	const issue = Number(positionals[0]);
	if (!Number.isInteger(issue) || !values.title) {
		console.error(
			"Usage: node scripts/kickoff.ts <issue number> --title <title> [--repo owner/name] [--context <path>] [--owns <files>] [--gates <text>] [--size <lines>]",
		);
		process.exitCode = 1;
	} else {
		console.log(
			kickoffWrite({
				context: values.context ?? null,
				gates: values.gates,
				issue,
				owns: values.owns ?? null,
				repo: values.repo,
				size: Number(values.size),
				title: values.title,
			}),
		);
	}
}
