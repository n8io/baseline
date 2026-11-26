// The shapes the template-render modules share.

export type TemplateAnswers = {
	// The Project's package name, e.g. "invoicing".
	name: string;
	// The one-line Project description: the first line of CONTEXT.md.
	description: string;
};

export type TemplateFile = { path: string; text: string };

// The forms of the name foo becomes: a context's or a Model's.
export type NameForms = { kebab: string; plural: string };

export const templateRepository = "n8io/baseline";
