// The Pieces of the stack: each one's identity once. Pure data; imports nothing.

// Every Piece of the stack a Project may remove with pnpm piece-remove. A new name here fails
// type-checking until `pieces`, `pieceRemovals` and model-create's piecesTemplate each say what
// the Piece is and does.
export const pieceNames = [
	"analytics",
	"api-reference",
	"cache",
	"error-tracking",
	"feature-flags",
	"live",
	"queue",
	"redis",
	"cli",
	"sdk",
	"ui",
] as const;

export type Piece = (typeof pieceNames)[number];

export const pieceIsKnown = (name: string): name is Piece =>
	(pieceNames as readonly string[]).includes(name);

type PieceIdentity = {
	// Pieces that must go first, when installed.
	after?: Piece[];
	// For a Piece that adds no package to the app: the package folder (its package.json) that tells
	// it is there instead. A folder left with only ignored files, such as node_modules, does not.
	folder?: string;
	// The packages it removes; the first one tells it is there, unless the Piece has a folder.
	packages: string[];
};

export const pieces: Record<Piece, PieceIdentity> = {
	analytics: { packages: ["@n8io/baseline-analytics"] },
	"api-reference": { packages: ["swagger-ui-dist"] },
	cache: { packages: ["@n8io/baseline-cache"] },
	"error-tracking": { packages: ["@n8io/baseline-error-tracking"] },
	"feature-flags": {
		packages: [
			"@n8io/baseline-feature-flags",
			"@launchdarkly/js-client-sdk",
			"@launchdarkly/node-server-sdk",
			"@launchdarkly/openfeature-node-server",
			"@openfeature/core",
			"@openfeature/launchdarkly-client-provider",
			"@openfeature/server-sdk",
			"@openfeature/web-sdk",
			"happy-dom",
		],
	},
	live: { packages: ["@n8io/baseline-live"] },
	queue: { packages: ["@n8io/baseline-queue"] },
	redis: { after: ["cache", "live"], packages: ["@n8io/baseline-redis"] },
	cli: { folder: "clients/cli", packages: [] },
	sdk: { after: ["cli"], packages: ["orval"] },
	ui: {
		packages: [
			"react-router",
			"@react-router/dev",
			"@react-router/node",
			"@tailwindcss/vite",
			"@types/react",
			"@types/react-dom",
			"class-variance-authority",
			"cn",
			// Gone from the Template, but a Project may have added it with a shadcn component.
			"lucide-react",
			"radix-ui",
			"react",
			"react-dom",
			"react-router-hono-server",
			"shadcn",
			"tailwindcss",
		],
	},
};

// What tells a Piece is in a Project: its folder, else its first package.
export const pieceSign = (piece: Piece): string =>
	pieces[piece].folder ?? pieces[piece].packages[0] ?? "";
