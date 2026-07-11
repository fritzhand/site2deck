# The method

site2deck packages a way of building decks, not just a build script. This page explains the five ideas the system is built on, in enough detail that you could re-derive it from scratch. The method was proven twice in a client engagement — two companies, two skins, one untouched engine — before it was extracted into this repo.

## 1. Scrape the real design system — don't reinvent it

The single highest-leverage move is refusing to design a palette. A company already has one: it's on their website, specified to the hex digit. `extract.mjs` pulls the exact values — the custom-property palette or the most-used hexes, the actual webfont, the same icon library the site loads, the real logo file — and writes them into a skin.

Why sampling beats guessing:

- **Recognition is instant.** When the deck's orange is *the* orange from the header and the headings are set in *the* site face, the audience reads the deck as "from the company" before a single word lands. A near-miss palette reads as a vendor template wearing the company's name.
- **Guessing produces committee colors.** Eyeballing "their blue" yields a plausible blue that argues with every screenshot and logo you place next to it. Sampling makes that entire class of error impossible.
- **The site already did the hard work.** Someone chose that palette to survive on white backgrounds, at small sizes, next to photography. Inheriting the choices inherits the testing.

One honest caveat: a hex value that works at 16px on a website may not work as a 50px display numeral or a tracked-uppercase label. Sampling gets you the right *family*; the spot-check (step 5) confirms each value in its new role.

## 2. Tokens are the only brand surface

`shared/deck.css` and `shared/deck.js` ship **zero brand values** — no colors, no font names, no logo paths. Everything brand-specific lives in one file per deck, `decks/<name>/tokens.css`: roughly 70 lines of CSS custom properties plus the `@font-face` blocks for the self-hosted brand fonts.

The consequences are what make the system scale:

- **Adding brand N+1 never touches `shared/`.** A new company is a new folder with a new `tokens.css`; the engine, the components, the print block, and the nav are inherited untouched. Nothing you do for brand five can regress brands one through four.
- **The skin is reviewable in one screen.** A designer (or an AI) can audit the entire brand encoding — palette, dark register, accents, type stack, radii — in a single small file, with each value commented with where on the site it came from.
- **The contract is enforceable.** Every skin defines the same complete set of variables (`--color-*`, `--accent*`, `--chart-*`, `--dark-*`, `--font-*`, `--radius-*`, `--stage-bg`), so a component written against the contract renders correctly under every skin, including ones that don't exist yet.

A useful subtlety: the contract's *roles* are flexible. `--font-mono` styles the tracked-uppercase label register, but if the brand has no monospace face, the skin points it at the brand sans (the first skin built this way mapped it to Raleway) — the role survives, the face adapts.

## 3. A component vocabulary, not freeform HTML

Slides are composed from a fixed set of classes defined in `shared/deck.css`: `.kicker`, `.lede`, `.card` and its accent variants, `.stats`, `.banner`, `.chips`, `.cols`/`.cols-3`/`.cols-4`, `.road` roadmap lanes, `.split` photo layouts, `.pcard` photo cards, `.feat` icon rows, `.phone` device frames, and so on ([full catalog](components.md)). Authoring a slide means choosing components and writing content into them — not writing CSS.

Why constrain yourself this way:

- **Every deck stays on-system.** A freeform slide drifts: a one-off font size here, a hand-picked grey there, and by slide 20 the deck has three design systems. Components consume tokens, so consistency is structural rather than disciplinary.
- **Slides become portable across brands.** A `.stats` row built for one company re-renders correctly under any other skin. Deck N is often deck N−1's structure with new content.
- **Editing stays fast.** Swapping a two-column layout for three cards is a class change, not a layout rewrite.

The vocabulary is allowed to grow — but only in `shared/deck.css`, only when a component is *genuinely missing*, and only built from tokens. If you're about to write inline styles on a slide, either an existing component already does it or the engine has earned a new one.

## 4. Single-file distribution is a design constraint

The deliverable is one HTML file that opens from `file://`, travels by email or chat, and prints to PDF. That sounds like packaging, but it works backwards into every design decision:

- **Fonts must be self-hosted.** A Google Fonts `<link>` dies without a network, so every skin ships woff2 files in `decks/<name>/fonts/` — which also means the deck renders identically in a boardroom with no wifi.
- **Icons must be self-hosted** for the same reason: the icon webfont lives in the deck's `assets/`, not on a CDN.
- **Assets stay per-deck**, so the inliner can resolve every reference relative to one folder, and the folder itself is portable.
- **The inliner fails loudly.** `build.mjs` throws if any relative `src`, `href`, or `url()` survives inlining. A build that "mostly works" until someone opens it on a plane is worse than a build that refuses to complete — the loud failure is what makes the single-file promise trustworthy.

The same constraint disciplines size: because everything embeds, a 7 MB photo folder becomes a 15 MB attachment. Recompress source images (~1600px, quality ~70) before they enter the deck.

## 5. The iteration loop: spot-check by eye

Extraction produces a first draft, not a finished skin. The design step is a tight loop: open `decks/<name>/index.html` in a browser, arrow through the slides next to the live website, edit `tokens.css`, reload. No build step — the build is only for shipping.

What to look at first, in rough order of how often it's wrong:

- **Is the primary too dusty on white?** A color sampled from a button or a hero overlay can wash out as a heading accent or a 50px stat numeral. It may need the palette's deeper step for text roles while a brighter tint (`--color-primary-tint`) carries the dark register.
- **Is the dark register muddy?** `--dark-bg` should read as ink — a near-black warmed or cooled toward the brand — not a grey. Check the cover, the `.banner`, and the closing slide specifically.
- **Is the label face wrong?** The tracked-uppercase kickers and chips (`--font-mono` roles) are where a wrong weight or face is most visible. They should echo how the site sets its own eyebrows and nav labels.
- **Do the tint surfaces stay quiet?** `--color-primary-light` and the surface tones should be barely-there washes; if a card background competes with its text, lighten it.
- **Is the logo crisp on both registers?** Check it top-right on light slides and on the dark cover; a logo pulled from a site header sometimes needs its white variant for dark use.

The generated `tokens.css` carries `TODO(spot-check)` comments on exactly the values that most often need this judgment — treat them as the checklist, and delete each one as you confirm or correct the value.

The same loop applies to facts, via the `.tbd` discipline: any number or claim you haven't verified gets wrapped in `<span class="tbd">TBD …</span>` *at authoring time*, while you still remember it's unverified. It renders loud (amber, dashed) so no draft can pass as final, and `grep 'class="tbd"'` is the pre-send audit.

## The design rules, and why

These are baked into the engine and the docs rather than left to taste:

- **No invented numbers, no overstated claims.** A deck in the company's own brand *looks* authoritative, which raises the cost of being wrong in it. Unknowns wear the `.tbd` marker; real numbers cite real sources.
- **No emoji, no gradients on type, no decorative shadows, no pill CTAs.** These are the tells of template decks, and they date fast. Their absence is most of what makes the output read as designed rather than generated.
- **Depth comes from borders and one ink "dark register."** Flat surfaces separated by hairline borders, with a single dark tone doing all the heavy contrast (cover, stat banner, closing), keeps the system calm, prints faithfully, and survives projection.
- **Two type registers, used consistently.** The display face carries h1/h2 and card headings; tracked-uppercase labels in the primary accent carry structure (kickers, eyebrows, table headers, footers). Hierarchy comes from role, not from improvised sizes.
- **The stage contract is inviolable.** Slides live on a 1280×720 card with container-query-clamped type. Never hardcode px font sizes in a slide — a hardcoded size breaks the responsive letterbox *and* the print geometry at once.
