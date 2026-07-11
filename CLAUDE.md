# CLAUDE.md — working in site2deck

site2deck turns a company website into a branded, offline, single-file HTML slide
deck: `extract.mjs` samples the site's design system into a per-deck `tokens.css`
skin over a brand-neutral engine (`shared/`), slides are authored from a fixed
component vocabulary, and `build.mjs` inlines everything into one standalone HTML
that opens from `file://` and prints to PDF.

## Commands

```bash
node extract.mjs https://example.com              # scaffold decks/<name>/ from a site
node extract.mjs https://example.com --name acme  # choose the deck folder name
node extract.mjs https://example.com --force      # overwrite an existing deck folder
node build.mjs                                    # rebuild every deck → decks/<n>/<n>-standalone.html
node build.mjs acme                               # one deck
node build.mjs acme --public                      # also drop data-internal slides → acme-public.html
npm run serve                                     # http://localhost:8000/decks/<name>/index.html
```

`npm run extract -- <url>` and `npm run build` wrap the same scripts. The optional
`npm run serve` alias shells out to python3's `http.server`; decks also open
directly from `file://` — serving is never required.

## File ownership — what you edit, what you never touch

| Path | Rule |
| --- | --- |
| `decks/<name>/index.html` | The deck. Edit freely — this is where slides live. |
| `decks/<name>/tokens.css` | The brand skin. Edit to match the live site. |
| `decks/<name>/assets/`, `fonts/` | Per-deck brand assets. Replace placeholders with real ones. |
| `decks/<name>/brand-report.json` | Extraction evidence. Read it; don't edit it. |
| `decks/<name>/*-standalone.html`, `*-public.html` | **GENERATED — never edit.** Edit `index.html`, rerun `node build.mjs <name>`. They are git-ignored. |
| `shared/deck.css` | The engine. Extend **only** for a genuinely missing component, and keep it brand-neutral — zero colour/font/radius literals; everything reads from tokens vars. |
| `shared/deck.js` | Navigation. Rarely a reason to touch it. |
| `extract.mjs`, `build.mjs` | Tooling. Don't modify while working on a deck. |

## The tokens contract

Every skin defines **all** of these in `decks/<name>/tokens.css` — the engine consumes
them and a missing one breaks a component silently (e.g. no `--accent-2-rgb` kills the
`.pcard.p-2` gradient and `.feat.c-2` icon boxes):

`--color-background/surface/surface-alt/border/border-strong/text/text-muted/text-faint`,
`--color-primary(/-dark/-light/-tint)`, `--color-on-primary`,
`--color-success/warning/error`, `--accent`, `--accent-2/3/4`,
`--accent-rgb`, `--accent-deep-rgb`, `--accent-2-rgb`, `--accent-2-deep-rgb`,
`--accent-3-rgb`, `--chart-1/2/3`, `--dark-bg/text/muted/border`,
`--font-display/body/mono`, `--radius-sm/md/lg`, `--stage-bg` —
plus `@font-face` blocks for the brand fonts self-hosted in `decks/<name>/fonts/`
(weights 400–800, woff2).

**Where the judgment calls live:** `extract.mjs` makes a best guess and marks every
uncertain choice with a `TODO(spot-check)` comment in `tokens.css`;
`brand-report.json` holds the evidence (sampled colours, detected fonts, logo URLs).
Resolve each TODO against the **live site**, not the report alone. The guided version
of this pass is `prompts/build-my-skin.md`. Note that `--font-mono` is a label face,
not necessarily a monospace: if the brand has no mono, point it at the face the site
uses for tracked-uppercase labels (the first skin built with this system mapped it
to Raleway for exactly that reason).

## Authoring rules

- **Component vocabulary first.** Slides are built from the classes in
  `docs/components.md` (read it before writing a slide). Inline styles are for
  per-slide tuning (column ratios, one-off `clamp()` spacing) — never hardcode a px
  font-size; type is `cqi`-clamped against the 1280×720 stage.
- **No invented numbers.** Every fact comes from the site or the user. Anything else —
  unit economics, market sizes, dates — is wrapped in `<span class="tbd">TBD …</span>`,
  which renders loud so drafts can't pass as final. Grep for `class="tbd"` before a
  deck ships.
- **No emoji, no gradients on type, no decorative shadows, no pill CTAs.** Depth comes
  from borders and one dark register.
- **Slides for internal eyes only** get `data-internal` on the `<section>` tag;
  `build.mjs <name> --public` strips them, and refuses to ship if any
  `data-internal` section survives stripping.
- **Assets stay per-deck** (`decks/<name>/assets/`, `/fonts/`), no external URLs —
  decks must open offline and the build fails loudly on unresolved references.

## The visual spot-check loop

This system is iterated by eye, not by tests:

1. Open `decks/<name>/index.html` directly in a browser (or `npm run serve`).
2. Walk **every** slide with the arrow keys at full width. Check: headline collisions
   with the top-right mark, cover-photo scrim legibility, card rows that overflow the
   720px card, accent colours against the live site side by side.
3. Narrow the window to ~390px and walk the deck again — grids collapse automatically,
   but long headlines and dense tables still need an eye.
4. Print-preview one deck occasionally: each slide should be one clean 1280×720 page.
5. Rebuild last: `node build.mjs <name>`, then open the `*-standalone.html` once to
   confirm fonts/images survived inlining. Never edit the built file.

## Adding a brand — runbook

1. `node extract.mjs https://the-site.com` → scaffolds `decks/<name>/` with
   `tokens.css`, starter slides, `brand-report.json`, and placeholder assets.
2. Refine the skin against the live site: resolve every `TODO(spot-check)` in
   `tokens.css` (real brand accent — not a link-blue; dark register sampled from the
   site's own dark surfaces; `--font-mono` decision). Use `prompts/build-my-skin.md`.
3. Replace placeholder assets: logo variants for light/dark, cover photography in the
   brand's own lighting, recompressed (~1600px max, quality ~70 — the difference
   between a 15 MB and a 4 MB standalone). Self-host the site's icon set if it has one.
4. Write the slides in `index.html` from the component vocabulary, facts sourced from
   the site or the user, `.tbd` for the rest.
5. Spot-check (loop above), then `node build.mjs <name>` and ship the standalone.
