# README rules

Read before writing or changing a README (root, a Package, the Template) or a README diagram. `test/readmes.test.ts` checks the parts marked _(test)_.

## Shape

- **Root** (`README.md`): an animated hero (the terminal types `pnpm app-create`, then `pnpm dev`), a nine-cell grid of benefit-first headlines, the pieces animation, and the Packages as an "I need to…" table. It sells the Template.
- **Package** (`packages/<name>/README.md`), in this order _(test)_:
  1. `# @n8io/baseline-<name>`, then a short paragraph that opens with a **bold promise**.
  2. The `pnpm add @n8io/baseline-<name>` line.
  3. An animated diagram, only where it explains a mechanism.
  4. `## Guarantees`: a `| You get | How |` table.
  5. `## Example`: a short example, then a testing note.
  6. `## Reference`: everything else, each part folded under `<details><summary>`. The first fold is **Exports**: a `| Export | Does |` table, one row per export, never a bullet list. A factory's row may also carry the options type it takes and the type it returns, comma separated after the call (`` `queueCreate({ … })`, `QueueOptions`, `Queue` ``); those then have no row of their own. A subpath export starts with its entry (`` `@n8io/baseline-queue/testing`: `queueTestConsumerRun(…)` ``), and an optional key ends in `?`. Each fold closes with a blank line before `</details>` _(test)_.
  7. A last line that starts `**Needs**`: peers, env vars, the vendor it runs on.

  Inside Reference, a folded part's old headings become `###` or a `<summary>`: the test reads every `##` outside code as a section.
- **Template** (`apps/app/README.md`): it becomes each Project's README. It keeps a `# app` title, one bold description line and a `<sub>` line about the Template, which the render turns into the Project's name, description and release link ([template.md](template.md)); it then says what runs, the commands and the pieces. The Content, Images and Diagrams rules apply.

## Content

- **Nothing is lost.** A rewrite never drops a documented feature, export, env var, runbook or upgrade note: reference goes into a `<details>` fold. Shorter at the top, never thinner overall.
- **Examples** are 3 to 15 lines _(test: 15, in a Package README above Reference)_ of real calls that compile against the current exports, with their imports, and follow the conventions other READMEs state (an `err` holds an `Error` subclass; an env var that may be unset is guarded). Show Zod where a caller passes a schema ([packages.md](packages.md#schemas)).
- **Testing notes** show the Package's memory stand-in ([packages.md](packages.md#test-exports)) or a hand-written double, never a spy, a stub or fake timers: a Project's tests may not use them.
- **Accurate.** Check every claim against the code on main. A number appears only where a README or test already measures it.
- **Glossary terms** from [CONTEXT.md](../../CONTEXT.md) and the glossaries [apps/app/CONTEXT-MAP.md](../../apps/app/CONTEXT-MAP.md) lists, never their `_Avoid_` aliases.
- **Vendor names** go only in a "Runs on" column or the Needs line, never in an API description, except where it describes a vendor-named factory or its `vendor` option ([packages.md](packages.md#vendors)).
- **Changesets.** A Package whose README changes gets a patch changeset, so npmjs shows the new page. The root README and diagrams need none.

## Images

- A Package or Template README links an image by its absolute URL, `https://raw.githubusercontent.com/n8io/baseline/main/docs/readme/<name>.svg`, because npm ships only README.md and a Project has no `docs/readme` _(test: no relative path, and a URL into this repo must name a committed file)_. The root README may use a relative path _(test: it must resolve)_. Badges from other hosts are allowed.
- Every image has alt text that says what the animation shows _(test: not empty)_.
- Never rename or delete a diagram a published README links: old npm pages read it from `main`.

## Diagrams

Each diagram is one file at the top of `scripts/readme-svg/`, `<name>.ts`, that default-exports its SVG string from `svgDocument` in [kit.ts](../../scripts/readme-svg/kit.ts). Name it after the README it serves (`root-hero.ts`, `queue-order.ts`); `kit-sample.ts` is the one exception. `pnpm readme-svg` writes it to `docs/readme/<name>.svg`; commit both _(test: equal, and no file without a generator)_. Copy `kit-sample.ts` to start. A helper two diagrams share goes in a subfolder (for example `scripts/readme-svg/queue/`), which the writer skips.

- **Themes**: `readmeSvgThemes.marquee` for the root, `readmeSvgThemes.blueprint` (with `svgGrid`) for Packages and the Template.
- **Text** goes through `svgText`, `svgBox` or `svgTypedText`, which escape it; raw markup uses `svgEscape` _(test: no bare `&` or `<`)_.
- **Self-contained** _(test)_: a `<title>`, no `<script>`, no `href`, `src` or `url()` outside the file, no external font. CSS keyframes and SMIL only, system font stacks. `svgDocument` draws the theme's own background so it reads on GitHub light and dark.
- **Reduced motion** _(test)_: put every `@keyframes` and `animation` rule in `motionCss`, which applies only when the viewer allows motion; static styles go in `css`. Give each element its finished look as its unanimated style. Under reduced motion `.typed` text shows in full and `.moving` elements hide, so every SMIL animation sits on an element with class `moving` (or is a typing reveal), and anything the resting frame needs moves by CSS transform instead.
- **Typing**: `svgTypedText` animates a clipPath rect's width with SMIL, because CSS width there does not repaint in Chrome. Times must satisfy `0 <= typedFrom <= typedUntil <= 92%` of the period (it clears from 92% to 97%); it throws otherwise.
- **Ids** (`svgTypedText`'s `id`, `svgGrid`'s optional `id`) are unique within a diagram.
- **Times**: `keyframePercent(seconds, period)` turns a moment into a keyframe offset, clamped to 0 to 100%; keep peaks clear of both ends so offsets do not collide.

Do not change `kit.ts`, `scripts/readme-svg-write.ts` or `test/readmes.test.ts` from a README or diagram change: propose the kit change on its own.
