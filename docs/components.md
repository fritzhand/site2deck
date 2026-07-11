# Component reference — the slide-authoring language

Every slide in a site2deck deck is plain HTML built from the component vocabulary in
`shared/deck.css`. The engine is brand-neutral: every colour, font, and radius it uses
comes from your deck's `tokens.css`, so the same markup renders in any brand. This page
is the full vocabulary — what each class is for, a minimal snippet, and the variants.

Snippets are adapted from a real shipped deck. Copy them, swap the copy and assets.

## Page skeleton

Every deck page (`decks/<name>/index.html`) uses the same chrome. `deck.js` queries
these ids at load — keep all of them:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Acme — Growth Story</title>
<meta name="robots" content="noindex, nofollow" />
<link rel="icon" type="image/png" href="assets/favicon-192.png" />
<link rel="stylesheet" href="tokens.css" />
<link rel="stylesheet" href="../../shared/deck.css" />
<!-- only if the deck uses icons (self-hosted webfont in assets/icons/): -->
<link rel="stylesheet" href="assets/icons/bootstrap-icons.css" />
</head>
<body>
<div class="progress" id="progress"></div>

<div class="stage" id="stage">

  <section class="slide cover active">
    <!-- cover slide (see below); `active` makes it paint before JS runs -->
  </section>

  <section class="slide">
    <!-- one <section class="slide"> per slide — deck.js counts them -->
  </section>

</div>

<!-- Light brand lockup, cloned into every non-cover slide by deck.js -->
<template id="mark-tpl">
  <div class="mark">
    <img class="mark-logo" src="assets/logo-mark.png" alt="Acme" />
    <span class="mark-div"></span>
    <span class="mark-txt"><b>Acme</b><i>Growth Story</i></span>
  </div>
</template>

<div class="controls">
  <button id="prev" aria-label="Previous slide">&#8249;</button>
  <div class="counter"><b id="cur">01</b> / <span id="total">00</span></div>
  <button id="next" aria-label="Next slide">&#8250;</button>
</div>
<div class="hint">&#8592; &#8594; navigate</div>

<script src="../../shared/deck.js"></script>
</body>
</html>
```

## What deck.js does at load

There is no config file. The script reads the DOM and wires everything:

- **Slide total from the DOM.** Every `<section class="slide">` inside `#stage` counts.
  Add or delete a slide and the counter, progress bar, and page numbers self-correct.
  `#total`'s placeholder text is overwritten.
- **Brand mark stamping.** The `#mark-tpl` template is cloned into the top-right of
  every slide, *except* `.cover` slides and slides that already contain a `.mark`
  (so you can hand-place a `.mark on-dark` over a photo). The template's `<img>` is
  inlined by the standalone build, so the mark works offline too.
- **Page numbers.** On content slides, the **second `<span>`** of `.slide-foot` is
  auto-replaced with `Page N / total`. Slides containing `.title-wrap` (cover,
  dividers, closing) are skipped — their second span keeps whatever you wrote
  (e.g. `Confidential`).
- **Navigation.** Arrow keys / space / PageUp / PageDown / Home / End. Click zones:
  right 38% of the window = next, left 22% = prev (clicks on links, controls, or an
  active text selection are ignored). Horizontal-dominant swipes on touch; vertical
  scrolling and panning inside `.menu` tables are left alone.
- **Hash deep-links.** `index.html#7` opens slide 7. The hash tracks the current
  slide as you navigate (via `history.replaceState`, so flipping slides doesn't pile
  up history — Back exits the deck rather than stepping through it). The current
  URL therefore survives a reload and works as a paste-able deep link (`#5`); a
  `hashchange` handler catches externally-set hashes (editing the URL bar) and
  jumps to that slide.

## Slide types

### Content slide — `.slide`

The default. A 1280×720 card, flex column, with the brand mark stamped top-right.
Standard shape: kicker, heading, body, footer.

```html
<section class="slide">
  <div class="kicker"><span class="num">04</span> Traction</div>
  <h2>A neighbourhood that already <em>trusts us</em>.</h2>
  <!-- body components here -->
  <div class="slide-foot"><span>Acme · Growth Story</span><span>Traction</span></div>
</section>
```

### Cover slide — `.slide.cover`

Photo-hero title on the dark register. Padding is zeroed; `.cover-photo` fills the
card and gets a legibility scrim automatically (side-lit at desktop widths, top-lit on
phones). Carries its own `.mark on-dark` because deck.js skips covers.

```html
<section class="slide cover active">
  <div class="cover-photo"><img src="assets/hero.jpg" alt="" /></div>
  <div class="mark on-dark">
    <img class="mark-logo" src="assets/logo-mark-white.png" alt="Acme" />
    <span class="mark-div"></span>
    <span class="mark-txt"><b>Acme</b><i>Growth Story</i></span>
  </div>
  <div class="title-wrap">
    <div class="title-main">
      <div class="kicker"><span class="num">01</span> Strategy narrative</div>
      <h1>From three stores to <em>a hundred</em>.</h1>
      <p class="title-sub">One paragraph of framing. <b>Bold the load-bearing phrase.</b></p>
      <div class="chips">
        <span class="chip">Agartala, Tripura</span>
        <span class="chip">3 stores today</span>
      </div>
    </div>
    <div class="slide-foot"><span>Acme · Growth Story</span><span>Confidential</span></div>
  </div>
</section>
```

On covers the kicker, `h1 em`, chips, and footer are automatically restyled for the
dark background (using `--color-primary-tint`).

### Divider / statement slide — `.slide.has-grid`

A title-style slide with a faint 64px grid texture (drawn from `--color-border-strong`,
masked to fade out toward the edges). Use for section breaks, the closing slide, or a
single big statement. Same `.title-wrap` structure as the cover, on the light background:

```html
<section class="slide has-grid">
  <div class="title-wrap">
    <div class="title-main">
      <div class="kicker"><span class="num">08</span> The honest part</div>
      <h2 style="font-size:clamp(28px,4.6cqi,56px);">A strong vision. But <em>vision alone is not enough</em>.</h2>
      <p class="title-sub" style="max-width:70ch;">The supporting paragraph.</p>
      <div class="chips">
        <span class="chip">Positioning</span>
        <span class="chip c-2">Customer understanding</span>
      </div>
    </div>
    <div class="slide-foot"><span>Acme · Growth Story</span><span>The tension</span></div>
  </div>
</section>
```

### Internal-only slides — `data-internal`

Tag any slide that must not reach an external audience by adding `data-internal`
to its `<section>` tag (anywhere in the tag):

```html
<section class="slide" data-internal>
```

`node build.mjs <name> --public` strips these and emits `<name>-public.html` — and
refuses to ship if any `data-internal` section survives stripping, so a redacted
build can never quietly leak an internal slide. The nav re-derives the count, so
nothing needs renumbering. The regular standalone keeps them.

## The brand mark — `.mark`

The top-right lockup (logo, hairline divider, two-line wordmark) that mirrors the
site's header. Defined once in `<template id="mark-tpl">`, stamped by deck.js.
Structure: `.mark-logo` (img), `.mark-div` (the hairline), `.mark-txt` with `<b>` brand
name and `<i>` deck subtitle. `.mark.on-dark` is the ink-glass variant for photo heroes
— hand-place it (usually with a white logo) since covers are skipped. On phone widths
the text and divider hide and only the logo remains.

## Typography

### Kicker — `.kicker` + `.num`

The tracked-uppercase slide label with an accent dash, in `--font-mono` (which a skin
may deliberately map to the brand's sans — see the tokens contract). The `.num` span is
the slide number, muted and tabular:

```html
<div class="kicker"><span class="num">05</span> Smart retail</div>
```

The number is static text — renumber by hand if you reorder slides (only the footer
`Page N` is automatic).

### Headings — `h1`, `h2`, `em`

Display-font, tight-tracked, balance-wrapped. `h1` for the cover only; `h2` everywhere
else. `<em>` inside either renders in the primary accent (not italic) — use it on the
phrase that carries the slide:

```html
<h2>How Acme grows is a <em>choice</em> — not a default.</h2>
```

`h3`/`h4` are body-font bold and belong inside components (cards, roadmap phases), not
as slide titles.

### Body — `.lede`, `p`, `.footnote`, `.eyebrow`

- `.lede` — the big intro paragraph under a heading. `<b>` inside it darkens to full
  ink. Default `max-width: 66ch`; widen inline for full-width slides
  (`style="max-width:80ch;"`).
- `p` — standard body copy inside components.
- `.footnote` — small faint sourcing/caveat line, usually last before `.slide-foot`.
- `.eyebrow` — a small tracked-uppercase label introducing a block mid-slide (like a
  kicker without the dash).

### The TBD marker — `.tbd`

Any number or fact not sourced from the site or the user gets wrapped — it renders
loud (amber, dashed border, mono) so a draft can never quietly pass as final:

```html
<p>How much funding does phase one need? <span class="tbd">TBD — to model</span></p>
```

Search the deck for `class="tbd"` before anything goes external.

### Slide footer — `.slide-foot`

Two spans, mono-tracked, pinned to the bottom by `margin-top: auto`:

```html
<div class="slide-foot"><span>Acme · Growth Story</span><span>Anything</span></div>
```

On content slides deck.js replaces the second span with `Page N / total`. On
title-wrap slides it keeps your text. Hidden on phone-width and short viewports.

## Title-block helpers

Used inside `.cover` and `.has-grid` slides:

- `.title-wrap` — full-height flex column; holds `.title-main` + `.slide-foot`.
- `.title-main` — vertically centres the title block.
- `.title-sub` — the subtitle paragraph; `<b>` darkens to full ink.
- `.brand-row` / `.brand-logo` — a large logo row (closing slides):

  ```html
  <div class="brand-row"><img class="brand-logo" src="assets/logo.png" alt="Acme" /></div>
  ```

- `.brand-lockup` — logo + vertical `.rule` + display-font `.wordmark`, echoing the
  site header:

  ```html
  <div class="brand-lockup">
    <img class="brand-logo" src="assets/logo-mark.png" alt="" />
    <span class="rule"></span>
    <span class="wordmark">Acme Technologies</span>
  </div>
  ```

## Layout

### Columns — `.cols`, `.cols-3`, `.cols-4`

Two, three, and four-column grids. Tune a specific slide's ratio with an inline style
— the phone breakpoint overrides it with `!important`, so inline ratios are safe:

```html
<div class="cols" style="grid-template-columns:0.9fr 1.1fr;">
  <div>…left…</div>
  <div>…right…</div>
</div>
```

A `.cols-3` with six children makes a 3×2 grid — that is the standard "six cards" slide.

### Vertical fill — `.fill-v`, `.fill-v.stretch`

Slides are flex columns; a lone grid on a sparse slide strands at the top. Add
`.fill-v` to grow the block and vertically centre its rows:

```html
<div class="cols-3 fill-v"> … cards … </div>
```

Add `.stretch` when the rows themselves should grow to fill the space (photo cards,
image grids): `class="cols-3 fill-v stretch"`. On `.road` the lanes grow with content
top-anchored, so the vertical dividers extend.

### Split — `.split` + `.split-media`

Half photo, half content — the workhorse layout. The media box crops its image to fill:

```html
<div class="split">
  <div class="split-media"><img src="assets/store.jpg" alt="Inside the store" /></div>
  <div style="display:flex; flex-direction:column; justify-content:center;">
    <p class="lede">The point of the slide, in one paragraph.</p>
    <ul class="clean" style="margin-top:clamp(14px,2cqi,20px);">
      <li><b>Bold lead-in</b> — supporting detail.</li>
      <li><b>Second point</b> — supporting detail.</li>
    </ul>
  </div>
</div>
```

The inline flex wrapper vertically centres the text column — that idiom appears on
almost every split slide. Swap the children to put the photo on the right.

## Components

### Chips — `.chips` > `.chip`

Small mono-tracked facts/tags with a square accent dot. `.c-2` / `.c-3` / `.c-4` move
the dot to the support accents. Chips can carry an inline icon:

```html
<div class="chips">
  <span class="chip">3 stores today</span>
  <span class="chip c-2">100-store ambition</span>
  <span class="chip"><i class="bi bi-shop" style="font-size:1.05em;"></i>&nbsp;Dhaleswar</span>
</div>
```

### Stat tiles — `.stats` > `.stat`

Editorial stat row: top-rule, big display-font value (`.v`), muted label (`.l`).
Auto-fits columns (min 200px), so four stats make four columns on desktop:

```html
<div class="stats">
  <div class="stat"><div class="v">5,000+</div><div class="l">happy customers</div></div>
  <div class="stat"><div class="v">5+</div><div class="l">years serving the neighbourhood</div></div>
  <div class="stat"><div class="v">3</div><div class="l">stores open today</div></div>
</div>
```

Only real numbers here — a `.stat .v` is the loudest element in the system. Unknown?
Use `.tbd` or cut the tile.

### Dark stat banner — `.banner`

The ink-register band: `--dark-bg` panel with accent-tint values (`.bv`) and muted
labels (`.bl`). Defaults to three columns; override inline for other counts:

```html
<div class="banner">
  <div><div class="bv">200+</div><div class="bl">projects delivered</div></div>
  <div><div class="bv">15+</div><div class="bl">years in the field</div></div>
  <div><div class="bv">5</div><div class="bl">product lines shipped</div></div>
</div>
```

A single-cell banner (`style="grid-template-columns:1fr;"`) works as a callout block
for "the #1 risk"-type statements.

### Cards — `.card`

Bordered surface card: mono kicker (`.ck`), display heading (`h3`), body (`p`), and an
optional bottom-pinned fineprint (`.emp`). Cards fill their grid row height, so a row
of cards bottom-aligns cleanly.

```html
<div class="cols-3 fill-v">
  <div class="card acc"><div class="ck">01 · Brand</div><h3>Why Acme?</h3><p>Can a customer say why Acme is different?</p></div>
  <div class="card acc-2"><div class="ck">02 · Economics</div><h3>Does a store pay?</h3><p>Contribution margin by format.</p></div>
  <div class="card acc-3"><div class="ck">03 · Capital</div><h3>What does it cost?</h3><p><span class="tbd">TBD — to model</span></p></div>
</div>
```

Variants:

- `.acc` / `.acc-2` / `.acc-3` / `.acc-4` — 3px top border in that accent; `.acc-2/3/4`
  also recolour the `.ck` kicker to match.
- `.feature` — the headline card: primary-tinted background, primary border. One per
  slide at most.

### Photo cards — `.pcard`

Full-bleed photo tile with an accent gradient rising from the bottom and white text
over it. Structure: the `<img>`, a `.pcard-grad` overlay, and a `.pcard-body` with
mono kicker (`.pk`), `h3`, `p`:

```html
<div class="cols-3 fill-v stretch">
  <div class="pcard p-1">
    <img src="assets/sector-1.jpg" alt="" />
    <div class="pcard-grad"></div>
    <div class="pcard-body"><div class="pk">Sector 01</div><h3>Infrastructure</h3><p>One line on the theme.</p></div>
  </div>
  <!-- .p-2, .p-3 … -->
</div>
```

`.p-1` / `.p-2` / `.p-3` tint the gradient with accent / accent-2 / accent-3 (via the
`--accent-*-rgb` triples in tokens.css); with no `p-*` class the gradient is neutral
ink. Pair with `.fill-v.stretch` so the tiles fill the stage.

### Roster — `.who`

Accent-ruled name/role pair for teams, contributors, or any label–value listing:

```html
<div class="cols-4">
  <div class="who"><div class="wn">A. Sharma</div><div class="wr">Founder — retail ops</div></div>
  <div class="who"><div class="wn">B. Das</div><div class="wr">Head of supply</div></div>
</div>
```

### Lists — `ul.clean` (+ `.tight`)

Bulletless list with accent-dot markers; `<b>` lead-ins darken to full ink. `.tight`
drops one type size for dense columns:

```html
<ul class="clean">
  <li><b>Faster checkout</b> — the whole store, a few taps away.</li>
  <li><b>Easy reordering</b> of daily essentials.</li>
</ul>
```

### Tables — `table.menu`

The register table for tiers, agendas, trajectories, option comparisons. Mono-tracked
header row, `.mot` for the bold row-label cell, `tr.hl` to highlight the
recommended/current row in the primary tint:

```html
<table class="menu">
  <thead><tr><th>Operating model</th><th>Brand control</th><th>Capital</th><th>Speed</th></tr></thead>
  <tbody>
    <tr><td class="mot">Company-owned</td><td>Highest</td><td>High</td><td>Slower</td></tr>
    <tr class="hl"><td class="mot">Hybrid</td><td>Medium</td><td>Medium</td><td>Balanced</td></tr>
  </tbody>
</table>
```

On phone widths the table scrolls sideways instead of cramming; swipes inside it pan
rather than change slides.

### Icon feature rows — `.feat`

Icon box (`.fi`) + title (`.ft`) + description (`.fd`). Icons come from the deck's
self-hosted icon webfont (e.g. Bootstrap Icons `bi bi-*`). `.c-2` / `.c-3` shift the
icon box to the support accents:

```html
<div class="cols">
  <div class="feat">
    <div class="fi"><i class="bi bi-lightning-charge-fill"></i></div>
    <div><div class="ft">Fast &amp; reliable delivery</div><div class="fd">On time, every time.</div></div>
  </div>
  <div class="feat c-2">
    <div class="fi"><i class="bi bi-shield-check"></i></div>
    <div><div class="ft">Trusted across town</div><div class="fd">Consistent quality, block by block.</div></div>
  </div>
</div>
```

### Category tiles — `.cats` > `.cat`

A row of icon tiles for categories/segments. Defaults to six columns (three on
phones); override inline for other counts:

```html
<div class="cats">
  <div class="cat"><i class="bi bi-basket"></i><span>Fruits &amp; Veggies</span></div>
  <div class="cat"><i class="bi bi-egg"></i><span>Dairy &amp; Eggs</span></div>
  <div class="cat"><i class="bi bi-box-seam"></i><span>Staples</span></div>
</div>
```

### Roadmap — `.road` > `.ph`

Phase lanes under a top rule: mono phase tag (`.pt`), `h4` title, then `p` or
`ul.clean`. Three lanes by default; add `.fill-v` so the lane dividers extend to the
footer:

```html
<div class="road fill-v">
  <div class="ph">
    <div class="pt">At the workshop</div>
    <h4>Decide the direction</h4>
    <ul class="clean"><li>Pressure-test the vision</li><li>Choose the operating model</li></ul>
  </div>
  <div class="ph">
    <div class="pt">Next 30–60 days</div>
    <h4>Build the foundation</h4>
    <ul class="clean"><li>Ship the brand system</li></ul>
  </div>
  <div class="ph">
    <div class="pt">This year</div>
    <h4>Prove &amp; prepare</h4>
    <ul class="clean"><li>Set staged rollout gates</li></ul>
  </div>
</div>
```

On phones the lanes stack with horizontal dividers.

### Photos — `.photo-grid`, `.mock`, `figure`

- `.photo-grid` — bordered, rounded, cropped images. Set the columns (and usually a
  height) inline; collapses to two columns on phones:

  ```html
  <div class="photo-grid" style="grid-template-columns:repeat(3,1fr); height:clamp(120px,18cqi,190px);">
    <img src="assets/store-1.jpg" alt="Storefront" />
    <img src="assets/store-2.jpg" alt="Interior" />
    <img src="assets/store-3.jpg" alt="Storefront" />
  </div>
  ```

- `.mock` — a bordered surface frame for a product screenshot; pair with
  `figure`/`figcaption` for a caption:

  ```html
  <figure>
    <div class="mock"><img src="assets/dashboard.png" alt="The dashboard" /></div>
    <figcaption>The live dashboard, as shipped.</figcaption>
  </figure>
  ```

### Phone frame — `.phone`

App screenshot in a device frame (ink bezel, rounded). Size it by height and centre it
in its column:

```html
<div style="display:flex; align-items:center; justify-content:center;">
  <div class="phone" style="height:clamp(240px,43cqi,428px);">
    <img src="assets/app-screenshot.jpg" alt="The app" style="height:100%; width:auto;" />
  </div>
</div>
```

## Authoring rules

- **The stage is a 1280×720 card and all type is container-query clamped.** `1cqi` is
  1% of the slide's width — 12.8px at full size, less on phones. **Never hardcode a px
  font-size in a slide.** For one-off sizing or spacing, use the same idiom the engine
  does: `style="margin-top:clamp(14px,2cqi,22px);"`.
- **Inline styles are for per-slide tuning only** — column ratios, one-off spacing,
  a wider `.lede`. Anything you'd write three times belongs in `shared/deck.css`; and
  extend `deck.css` only for a genuinely missing component, never with brand values
  (those live in `tokens.css`).
- **No invented numbers.** Every fact comes from the brand's site or from the user;
  everything else is `<span class="tbd">TBD …</span>`. Grep for `class="tbd"` before a
  deck goes out.
- **No emoji, no gradients on type, no decorative shadows, no pill CTAs.** Depth comes
  from borders and the one dark register. Display font for `h1`/`h2` and card
  headings; tracked-uppercase labels in the primary accent.
- **Accents are semantic, not decorative.** `.acc`/`.c-2`/`.p-2` group related items —
  use one accent per theme, not a rainbow per row.
- **Assets stay in the deck folder** (`assets/`, `fonts/`) so the deck is portable and
  the standalone build can inline everything. No external URLs anywhere.

## Responsive and print behavior

You get these for free; know them so you don't fight them:

- **Narrow slides (container < 760px):** every multi-column grid (`.cols*`, `.stats`,
  `.split`, `.banner`, `.road`) collapses to one column — with `!important`, so your
  inline desktop ratios don't clip content on phones. `.photo-grid` goes to two
  columns, `.cats` to three. `.menu` tables scroll sideways. The mark drops to
  logo-only, and the kicker reserves room for it.
- **Phone viewports (< 740px wide):** the letterbox and 720px height cap disappear —
  the slide becomes a full-bleed scrolling page. `.slide-foot` and the key hint hide;
  bottom padding keeps content clear of the nav controls.
- **Short viewports (< 560px tall):** content top-anchors and the footer hides.
- **Print:** browser Print → Save as PDF. The `@media print` block renders every slide
  as an exact 1280×720 page with colours forced and nav chrome hidden. Headless:
  `chromium --headless --print-to-pdf=deck.pdf decks/<name>/<name>-standalone.html`.

Spot-check every slide at full width **and** at a ~390px window before you ship — the
collapse is automatic but long headlines, tall tables, and dense card rows still
deserve an eye.
