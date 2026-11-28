// pnpm ui-shot [--label <name>] [--path <route>]... [--sign-in] [--entry] [--url <origin>] [--out <dir>]:
// screenshots pages of the built app, desktop and phone, at a device scale factor of 2. The files go
// to a folder outside the repository (the system temp folder by default) for a person to drop into a
// PR description: docs/agents/ui.md. Without --url it boots its own instance on free ports.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { argsFail, argsParse } from "./args.ts";
import { uiServerStart } from "./ui-server.ts";

const usage = `Usage: pnpm ui-shot [--label <name>] [--path <route>]... [--sign-in] [--entry] [--url <origin>] [--out <dir>]

Screenshots each route at 1280x800 and 390x844, full page, device scale factor 2. Run it on main
with --label before, then on the branch with --label after, and put the files in the PR body.

  --label <name>   the file name prefix (default after)
  --path <route>   a route to shoot; repeat it for more (default /auth/sign-in)
  --sign-in        sign in as the Dev user first, for pages behind the sign-in
  --entry          also shoot the list page and a new entry's detail page (signs in, creates an
                   entry): <label>-list-<viewport>.png and <label>-detail-<viewport>.png
  --url <origin>   shoot a running app; without it ui-shot boots its own (pnpm build first)
  --out <dir>      where the files go (default <temp folder>/ui-shots/<this folder's name>)
  -h, --help       this help`;

export const uiShotViewports = {
	desktop: { height: 800, width: 1280 },
	phone: { height: 844, width: 390 },
} as const;

type UiShotViewport = keyof typeof uiShotViewports;

// `before-auth-sign-in-phone.png` for label `before`, route `/auth/sign-in` and the phone viewport.
export const uiShotFileNameCreate = ({
	label,
	path,
	viewport,
}: {
	label: string;
	path: string;
	viewport: UiShotViewport;
}): string => {
	const slug = path
		.replace(/[?#].*$/, "")
		.replaceAll(/[^a-zA-Z0-9]+/g, "-")
		.replaceAll(/^-|-$/g, "");
	return `${label}-${slug || "home"}-${viewport}.png`;
};

// The default folder: outside the repository, one per worktree folder, so shots never get committed.
export const uiShotDirDefault = (cwd: string): string =>
	join(tmpdir(), "ui-shots", basename(resolve(cwd, "../..")));

// `ci-detail-phone.png` for label `ci`, the detail page and the phone viewport.
export const uiShotEntryFileNameCreate = ({
	label,
	page,
	viewport,
}: {
	label: string;
	page: "detail" | "list";
	viewport: UiShotViewport;
}): string => `${label}-${page}-${viewport}.png`;

// A name no other run has used, so the detail page is the one this run created.
const entryNameCreate = (): string =>
	`shot${Math.random().toString(36).slice(2, 10)}`;

type UiShotEntryFiles = Record<
	UiShotViewport,
	{ detail: string; list: string }
>;

// The home page redirects to the list; its form creates an entry and lands on the entry's detail page,
// the same path ui-flows.test.ts takes.
const entryShoot = async ({
	files,
	origin,
	page,
}: {
	files: { detail: string; list: string };
	origin: string;
	page: Page;
}): Promise<void> => {
	await page.goto(`${origin}/`);
	await page.getByLabel("Name").waitFor();
	await page.screenshot({ fullPage: true, path: files.list });
	console.log(files.list);
	const name = entryNameCreate();
	await page.getByLabel("Name").fill(name);
	await page.getByRole("button", { name: "Create" }).click();
	await page.waitForURL((url) => /^\/[^/]+\/[^/]+$/.test(url.pathname));
	await page.getByText(name, { exact: true }).waitFor();
	await page.waitForLoadState("networkidle");
	await page.screenshot({ fullPage: true, path: files.detail });
	console.log(files.detail);
};

const labelPattern = /^[a-z0-9][a-z0-9-]*$/;

const shoot = async ({
	entryFiles,
	files,
	origin,
	signIn,
}: {
	entryFiles?: UiShotEntryFiles | undefined;
	files: { file: string; path: string; viewport: UiShotViewport }[];
	origin: string;
	signIn: boolean;
}): Promise<void> => {
	const browser = await chromium.launch();
	try {
		for (const viewport of Object.keys(uiShotViewports) as UiShotViewport[]) {
			// A context per viewport: its own cookies, so the sign-in below is its own too.
			const context = await browser.newContext({
				deviceScaleFactor: 2,
				viewport: uiShotViewports[viewport],
			});
			const page = await context.newPage();
			if (signIn || entryFiles !== undefined) {
				await page.goto(`${origin}/auth/sign-in`);
				await page.getByRole("button", { name: "Dev user" }).click();
				await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
			}
			if (entryFiles !== undefined) {
				await entryShoot({ files: entryFiles[viewport], origin, page });
			}
			for (const file of files.filter((entry) => entry.viewport === viewport)) {
				await page.goto(`${origin}${file.path}`, { waitUntil: "networkidle" });
				await page.screenshot({ fullPage: true, path: file.file });
				console.log(file.file);
			}
			await context.close();
		}
	} finally {
		await browser.close();
	}
};

const entryFilesCreate = ({
	label,
	out,
	viewport,
}: {
	label: string;
	out: string;
	viewport: UiShotViewport;
}): { detail: string; list: string } => ({
	detail: join(
		out,
		uiShotEntryFileNameCreate({ label, page: "detail", viewport }),
	),
	list: join(out, uiShotEntryFileNameCreate({ label, page: "list", viewport })),
});

// The exit code, or undefined when argsParse has already said what it needed to.
const main = async (): Promise<number | undefined> => {
	const parsed = argsParse({
		options: {
			label: { default: "after", type: "string" },
			out: { type: "string" },
			path: { multiple: true, type: "string" },
			entry: { type: "boolean" },
			"sign-in": { type: "boolean" },
			url: { type: "string" },
		},
		usage,
	});
	if (parsed === undefined) return undefined;
	const { values } = parsed;
	if (!labelPattern.test(values.label)) {
		argsFail(
			"ui-shot",
			`--label takes a-z, 0-9 and hyphens, got ${values.label}`,
		);
		return 1;
	}
	const paths = values.path?.length ? values.path : ["/auth/sign-in"];
	const bad = paths.find((path) => !path.startsWith("/"));
	if (bad !== undefined) {
		argsFail("ui-shot", `--path starts with /, got ${bad}`);
		return 1;
	}
	const out = resolve(values.out ?? uiShotDirDefault(process.cwd()));
	mkdirSync(out, { recursive: true });
	const files = paths.flatMap((path) =>
		(Object.keys(uiShotViewports) as UiShotViewport[]).map((viewport) => ({
			file: join(
				out,
				uiShotFileNameCreate({ label: values.label, path, viewport }),
			),
			path,
			viewport,
		})),
	);
	const entryFiles: UiShotEntryFiles | undefined =
		values.entry === true
			? {
					desktop: entryFilesCreate({
						label: values.label,
						out,
						viewport: "desktop",
					}),
					phone: entryFilesCreate({
						label: values.label,
						out,
						viewport: "phone",
					}),
				}
			: undefined;
	if (values.url !== undefined) {
		await shoot({
			entryFiles,
			files,
			origin: values.url.replace(/\/+$/, ""),
			signIn: values["sign-in"] === true,
		});
		return 0;
	}
	await using server = await uiServerStart();
	await shoot({
		entryFiles,
		files,
		origin: server.url,
		signIn: values["sign-in"] === true,
	});
	return 0;
};

if (import.meta.main) {
	try {
		process.exitCode = (await main()) ?? process.exitCode;
	} catch (error) {
		argsFail("ui-shot", error instanceof Error ? error.message : String(error));
	}
}
