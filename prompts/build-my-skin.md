# build-my-skin — the judgment pass, as a prompt

`extract.mjs` gets a skin 80% right mechanically. The last 20% — is that really the
brand's accent, is the dark register actually theirs, do the slides say anything true —
is judgment. This prompt packages that judgment pass for any capable AI assistant
(Claude Code or similar) working in a clone of this repo.

**Before you paste it:** run the extraction first —

```bash
node extract.mjs https://YOUR-SITE.com
```

Note the deck name it creates under `decks/` (or pass `--name`). Then copy everything
below the line, replace `<SITE-URL>` and `<deck-name>`, and paste it to your assistant.

---

I ran `node extract.mjs <SITE-URL>`, which scaffolded `decks/<deck-name>/`. Your job
is the judgment pass that turns that mechanical extraction into a skin and deck that
actually look and read like the brand. Work through the steps in order. Two hard
rules up front:

- **Never invent a number or a claim.** Every fact in the deck comes from the site or
  from me. Anything else gets wrapped in `<span class="tbd">TBD …</span>` — including
  things you are "pretty sure" about.
- **Keep provenance.** For every colour and font you settle on, be ready to tell me
  exactly where it came from: a CSS value on the site, a sampled pixel of which
  element, an entry in `brand-report.json`. If I ask "why this purple?", you answer
  with evidence, not taste.

## 1. Put the site and the evidence side by side

Open the live site (<SITE-URL>) and `decks/<deck-name>/brand-report.json` together.
If you can browse, actually load the site — homepage plus one or two inner pages —
and compare what you see against what the extractor sampled. If you cannot browse,
ask me for screenshots of the homepage (top and footer) before changing any colour.

## 2. Resolve every TODO(spot-check) in tokens.css

`decks/<deck-name>/tokens.css` marks each uncertain choice with a `TODO(spot-check)`
comment. Go through them all; for each one, decide against the live site and delete
the TODO once resolved. The questions that matter:

- **Is `--color-primary` the brand's real accent** — the colour of their logo, their
  buttons, the thing they'd call "our colour" — and not a default link-blue, a
  Bootstrap/Tailwind stock swatch, or the colour of one random banner? If the sampled
  value is too light to hold tracked-uppercase labels on white, deepen it and keep the
  original as `--color-primary-tint` for use on the dark register.
- **Do `--accent-2/3/4` come from the brand's actual supporting hues** — a secondary
  logo colour, an illustration palette, a recurring photo tone — and not from colours
  you'd merely like them to have? If the site genuinely has one colour, derive the
  support accents from it (deep/tint variants) rather than importing strangers.
  Update the `--accent-*-rgb` triples to match whatever you change.
- **Is the dark register (`--dark-bg`, `--stage-bg`, `--dark-text/muted/border`)
  sampled from the site's own dark surfaces** — its footer, hero, or nav — rather than
  a generic near-black? The stage behind the slides should feel like their site at
  night, not like anyone's.
- **Should `--font-mono` be a real monospace or the brand's label face?** Look at how
  the site sets small uppercase labels, eyebrows, and nav items. If the brand has no
  mono, point `--font-mono` at that label face — the first skin built with this
  system mapped it to Raleway because that site's tracked-uppercase language was
  Raleway bold. A code-y brand that actually uses a mono keeps a mono.
- Sanity-check the rest: `--color-warning` (the `.tbd` marker) must read as amber and
  stay distinct from the brand accents; `--radius-*` should echo the site's corner
  language (sharp and engineered vs rounded and friendly).

## 3. Swap placeholder assets for real ones

In `decks/<deck-name>/assets/`:

- **Logo**: replace the file the deck actually references — in the scaffold that is
  `assets/logo.svg`, used in three places in `index.html`: the `#mark-tpl` top-right
  lockup, the cover's hand-placed `.mark.on-dark`, and the closing slide's
  `.brand-row`. If the brand needs variants (a colour mark for light slides, a
  white or light mark for the dark cover, the full lockup for the closing slide),
  add them to `assets/` and update those three references to point at the right
  variant. Pull the files from the site; never redraw or restyle a logo.
- **Cover photography** in the brand's own lighting and subject matter — their
  storefront, their hardware, their people — not stock that merely matches the
  palette. The cover scrim assumes a photo that can sit under dark glass.
- **Recompress anything large**: source images ≈1600px max, quality ~70 (`sips` or
  similar). This is the difference between a 15 MB standalone and a 4 MB one.

## 4. Self-host the site's icon set, if one was detected

If `brand-report.json` detected an icon webfont (Bootstrap Icons, Font Awesome, a
custom set), self-host it under `decks/<deck-name>/assets/icons/` and link it from
`index.html`, so `.feat` and `.cats` slides speak the same icon language as the site —
offline. If the site has no icon set, leave icons out rather than importing a
foreign one.

## 5. Rewrite the starter slides into a real narrative

Replace the scaffold's placeholder slides in `decks/<deck-name>/index.html` with a
deck that says something, using only the component vocabulary in
`docs/components.md` (read it first). Constraints:

- **Facts come from the site or from me.** Positioning lines, product names, category
  lists, stats the site itself publishes — usable. Everything else — market sizes,
  revenue, growth targets, dates I haven't given you — is `<span class="tbd">TBD …</span>`.
- Ask me what the deck is *for* (pitch, strategy readout, company profile) before
  writing; structure follows purpose.
- Mark any slide I tell you is internal-only by adding `data-internal` to its
  `<section>` tag — `node build.mjs <deck-name> --public` strips those slides and
  refuses to ship if one survives stripping.
- No emoji, no gradients on type, no px font-sizes; `em` in headings for the accent
  phrase; every content slide gets the two-span `.slide-foot`.

## 6. Build and report the scorecard

Run:

```bash
node build.mjs <deck-name>
```

Open the deck, walk every slide at full width and at a ~390px window, then give me a
scorecard — a short honest list of what still needs a human eye, at minimum:

- Colour calls you made with **low confidence**, with the evidence for each.
- Every remaining `TODO(spot-check)` you could not resolve and why.
- Every `.tbd` left in the deck (grep `class="tbd"`), so I can fill in real numbers.
- Assets still placeholder or of poor quality (blurry logo, wrong-lighting photo).
- The standalone's file size, and which images to recompress if it's over ~5 MB.

Do not present the deck as finished. It is finished when the scorecard is empty and I
say so.
