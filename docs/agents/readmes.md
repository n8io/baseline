# README rules

Read before writing or changing a README (root, a Package, the Template) or a README diagram. `test/readmes.test.ts` checks the parts marked _(test)_.

## Shape

- **Root** (`README.md`): an animated hero (the terminal types `pnpm app-create`, then `pnpm dev`), a nine-cell grid of benefit-first headlines, the pieces animation, and the Packages as an "I need to…" table. It sells the Template.
- **Package** (`packages/<name>/README.md`), in this order _(test, once the README has `## Guarantees`)_:
  1. `# @n8io/baseline-<name>`, then one sentence that opens with a **bold promise**.
  2. The `pnpm add @n8io/baseline-<name>` line.
  3. An animated diagram, only where it explains a mechanism.
  4. `## Guarantees`: a `| You get | How |` table.
  5. `## Example`: a short example, then a testing note.
  6. `## Reference`: everything else, each part folded under `<details><summary>`.
  7. A last line that starts `**Needs**`: peers, env vars, the vendor it runs on.

## Content

- **Nothing is lost.** Every feature, export, env var, runbook and upgrade note in the old README stays, folded into `<details>` if it is reference. Shorter at the top, never thinner overall.
- **Examples** are 3 to 15 lines _(test: 15)_ of real calls that compile against the current exports. Show Zod where a caller passes a schema ([packages.md](packages.md#schemas)).
- **Accurate.** Check every claim against the code on main. A number appears only where a README or test already measures it.
- **Glossary terms** from [CONTEXT.md](../../CONTEXT.md) and [apps/app/CONTEXT.md](../../apps/app/CONTEXT.md), never their `_Avoid_` aliases.
- **Vendor names** go only in a "Runs on" column or the Needs line, never in an API description.
- **Changesets.** A Package whose README changes gets a patch changeset, so npmjs shows the new page. The root README and diagrams need none.

## Images

- A Package or Template README links an image by its absolute URL, `https://raw.githubusercontent.com/n8io/baseline/main/docs/readme/<name>.svg`, because npm ships only README.md and a Project has no `docs/readme` _(test: the path must be committed)_. The root README may use a relative path _(test: it must resolve)_.
- Every `<img>` has alt text that says what the animation shows.

## Diagrams

Each diagram is one file, `scripts/readme-svg/<name>.ts`, that default-exports its SVG string from `svgDocument` in [kit.ts](../../scripts/readme-svg/kit.ts). Name it after the README it serves (`root-hero.ts`, `queue-order.ts`). `pnpm readme-svg` writes it to `docs/readme/<name>.svg`; commit both _(test: equal)_. Copy `kit-sample.ts` to start.

- **Themes**: `readmeSvgThemes.marquee` for the root, `readmeSvgThemes.blueprint` (with `svgGrid`) for Packages and the Template.
- **Self-contained** _(test)_: a `<title>`, no `<script>`, no link to another host, no external font. CSS keyframes and SMIL only, system font stacks. `svgDocument` draws the theme's own background so it reads on GitHub light and dark.
- **Reduced motion** _(test)_: `svgDocument` applies a diagram's `css` only when the viewer allows motion; otherwise it shows `.typed` text in full and hides `.moving` elements. So give each element its finished look as its unanimated style, and put class `moving` on anything SMIL moves. No `!important`: Biome lints the committed SVGs.
- **Typing**: use `svgTypedText`. It animates a clipPath rect's width with SMIL, because CSS width there does not repaint in Chrome.
- Times: `keyframePercent(seconds, period)` turns a moment into a keyframe offset.

Only the README kit's ticket changes `kit.ts`, `scripts/readme-svg-write.ts` or `test/readmes.test.ts`; a diagram that needs more adds a helper in its own file.
