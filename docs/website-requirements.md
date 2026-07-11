# What your website needs

`extract.mjs` builds a brand skin from what a website exposes over plain HTTP: server-rendered HTML and the CSS it links. Every signal below has a best case, a fallback, and a manual fix — nothing here is fatal, but the more of the best-case column your site hits, the closer the generated skin lands on the first try.

After extraction, the console scorecard and `decks/<name>/brand-report.json` tell you signal-by-signal what was found; the section anchors on this page are what the scorecard points at.

## Stylesheets

**What extract.mjs looks for.** The foundation for everything else: CSS actually reachable in the server response — `<link rel="stylesheet">` targets it can fetch, plus inline `<style>` blocks. Colors and fonts are mined from this text.

**Best case.** A server-rendered site (static HTML, WordPress, Next.js/Astro/Rails with real markup, even a Tailwind build) whose stylesheets arrive as CSS files. Minified is fine.

**When it's missing.** JS-rendered SPAs are the failure mode: if the page ships as an empty `<div id="root">` and styles are injected at runtime (CSS-in-JS, client-only rendering), the extractor sees almost nothing — expect a sparse scorecard across every signal. `extract.mjs` fetches; it does not run a browser. See [JS-rendered sites](#js-rendered-sites) for the options.

**Manual fix.** Open the real page in a browser, use devtools to read the computed styles off the header, a heading, and a button, and take the [manual skin path](#manual-skin-path) below. The scaffold still saves you the engine work; you're only supplying the values.

## Colors

**What extract.mjs looks for.** CSS custom properties with brand-ish names (`--primary`, `--brand`, `--accent`, theme palettes), the frequency ranking of hex/rgb values across all reachable CSS, and the `<meta name="theme-color">` value.

**Best case.** A site with a declared custom-property palette — the brand encoded by its own developers, names and all. Consistent hex usage (the same orange written the same way everywhere) makes the frequency ranking sharp, and `theme-color` gives a tie-breaking vote for the primary.

**When it's missing.** With no custom properties, extraction falls back to most-used colors — which can surface framework greys or a CDN reset's palette ahead of the brand. The skin will still be *filled in*, but with lower confidence, and the `TODO(spot-check)` comments in `tokens.css` become mandatory reading rather than a formality.

**Manual fix.** Screenshot the site's header, hero, and a primary button; pick the exact values with a color picker (browser-devtools eyedropper or macOS Digital Color Meter) and write them into `tokens.css` — primary, its dark and tint steps, and the dark register. Sample the logo file too; it's often the cleanest statement of the brand color.

## Fonts

**What extract.mjs looks for.** A Google Fonts `<link>` (family and weights are in the URL, and woff2 files can be fetched for self-hosting), or `@font-face` rules in the CSS pointing at woff2 sources, plus the `font-family` stacks used on body text and headings.

**Best case.** Google Fonts, or self-hosted `@font-face` with reachable woff2 files in weights 400–800. Either way the extractor can download the faces into `decks/<name>/fonts/` and write the `@font-face` blocks — decks must open from `file://`, so fonts are always self-hosted, never hot-linked.

**When it's missing.** If the site uses a licensed foundry face (Adobe Fonts, commercial webfont services) or a bare system stack, the extractor can name the family but not fetch it. The skin ships with a system-stack placeholder and a TODO naming the real face.

**Manual fix.** For an open face: download the woff2 files (Google Fonts, or the [google-webfonts-helper](https://gwfh.mranftl.com/fonts) for direct woff2 downloads), drop them in `decks/<name>/fonts/`, and update the `@font-face` blocks in `tokens.css`. For a licensed face: check your license permits self-hosting, or pick the closest open alternative (the deck's `--font-*` stacks make the swap one line).

## Logo

**What extract.mjs looks for.** An `<img>` whose `src`, `alt`, or `class` contains "logo" — SVG preferred, since it scales cleanly on both the light slides and the dark cover. Failing that: `apple-touch-icon` (usually a clean square mark at usable resolution), then `og:image` (often a lockup, sometimes a promotional banner).

**Best case.** An SVG logo in the site header. It lands in `decks/<name>/assets/` and works at every size the deck needs, from the top-right mark to the closing slide.

**When it's missing.** CSS-background logos, sprite sheets, and inline-SVG-without-a-file all evade the `<img>` scan. The fallbacks can be low-resolution (favicon-derived) or the wrong shape (an `og:image` banner), and none of them provide the white-on-dark variant the cover slide wants.

**Manual fix.** Get the real file: the company's press/brand page if one exists, or save the asset directly from devtools (Network panel, filter by Img/SVG). Put it in `decks/<name>/assets/` and point the deck's logo references at it. If there's no white variant for dark slides, a monochrome SVG can be recolored with one `fill` edit.

## Icons

**What extract.mjs looks for.** A recognizable icon library in the page's links and CSS: Bootstrap Icons, Font Awesome, Material Icons/Symbols, Lucide, Heroicons, or Phosphor. When it finds one, it names the library (with the evidence) in `brand-report.json` and the scorecard — detection only; nothing is downloaded.

**Best case.** One of the libraries above loaded the standard way (CDN link or npm-built CSS). The report then tells you exactly which set to self-host, so the deck's feature rows and category tiles can use literally the same glyphs the website uses. Self-hosting is your step, not the extractor's: download the library into `decks/<name>/assets/icons/` and link its CSS from `index.html` — never hotlink, since the deck must open from `file://`. The guided version of this step is [prompts/build-my-skin.md](../prompts/build-my-skin.md) step 4.

**When it's missing.** Custom inline SVG icons or no icons at all. This is the most cosmetic of the signals — the deck's `.feat` and `.cats` components want an icon font, but every other component works without one.

**Manual fix.** Pick whichever supported library best matches the site's icon style, download its CSS and font files into `decks/<name>/assets/icons/`, and link the CSS from `index.html` (the page skeleton in [docs/components.md](components.md#page-skeleton) shows the link line). Or skip icons: the components read fine with the icon boxes removed.

## Meta

**What extract.mjs looks for.** `og:site_name` (the company's name as it styles it), `og:image`, `theme-color`, and the favicon. Cheap signals that name the deck, seed cover imagery, corroborate the primary color, and give the standalone file a browser-tab icon.

**Best case.** A filled-in Open Graph block — one `curl` worth of HTML yields the proper company name and a hero-quality share image.

**When it's missing.** Nothing breaks; the deck is named from the domain and the cover ships with a placeholder photo slot. It's the difference between "Acme Systems" and "acmesystems.com" on the title slide.

**Manual fix.** Set the name in `index.html`'s title slide and `<title>`, and drop a real photo into `decks/<name>/assets/` for the cover.

## JS-rendered sites

**What extract.mjs sees.** `extract.mjs` fetches a URL and reads what the server sends: the HTML and the CSS files it links. It does not run a browser. On a client-rendered SPA the server response is often a shell — an empty `<div id="root">`, a few kilobytes of bootstrap markup, and stylesheets that arrive as JavaScript (CSS-in-JS) rather than CSS. Every signal above is mined from that response, so when the response is a shell, every signal is thin at once: no custom-property palette, no `@font-face`, no `<img>` logo, a near-empty frequency ranking.

**How you'll know.** The scorecard prints a `[!]` warning when the page looks JS-rendered (little visible text, an empty root element, disproportionately little CSS) and points here. A sparse `brand-report.json` across all signals is the same diagnosis.

**Options, in order of preference.**

- **Run against the production domain, not a dev server.** Many frameworks (Next.js, Astro, Nuxt, SvelteKit) server-render or prerender in production while serving an empty shell in development. `node extract.mjs https://yourcompany.com` against the deployed site often works where `localhost:3000` yields nothing.
- **Temporarily prerender.** If you control the site, a one-off static export or SSR-enabled build (even deployed to a scratch URL) gives the extractor real markup and real CSS to sample. The extractor takes a URL, so the page does need to be reachable over HTTP somewhere.
- **Fall back to the [manual skin path](#manual-skin-path).** An hour with devtools and a color picker beats fighting the toolchain — the scaffold still does the engine work, you only supply the values.

Meta tags are the one partial exception: `og:*` and `theme-color` usually live in the served `<head>` even on SPAs, so the deck name and a corroborating color often survive when everything else misses.

## Reading brand-report.json

Every extraction writes `decks/<name>/brand-report.json` — the machine-readable record of the run, one entry per signal above: what was searched, what was found, where it came from (which stylesheet, which meta tag, which URL), and what the extractor fell back to when the best case missed. The console scorecard is a summary of this file, and its failing rows point at the matching sections of this page.

Use it two ways:

- **As the audit trail.** When a color in `tokens.css` looks off during the spot-check, the report tells you where that value came from — a named custom property is strong evidence, "third most-used hex" is a guess you should verify against the live site.
- **As the worklist.** Anything reported as a fallback or a miss corresponds to a `TODO(spot-check)` in the generated `tokens.css`. Fix them in the order they hurt: colors and fonts change every slide; logo, icons, and meta are more contained.

## Manual skin path

If a site fails everything — an SPA with runtime styles, a login wall, or no website at all — skip extraction and build the skin by hand. It's an hour of work, not a compromise:

```bash
cp -r decks/starter decks/acme
```

1. **Colors.** Screenshot the brand's site or app; pick exact values with a color picker (devtools eyedropper, macOS Digital Color Meter). Fill the `--color-*`, `--accent*`, and `--dark-*` variables in `decks/acme/tokens.css` — every variable is commented with its role.
2. **Fonts.** Identify the face (devtools computed styles, or a font-identifier tool on a screenshot), download woff2 in weights 400–800, drop them in `decks/acme/fonts/`, and update the `@font-face` blocks and `--font-*` stacks.
3. **Logo.** Get the real file from the company (or its press page) into `decks/acme/assets/`.
4. **Spot-check.** Open `decks/acme/index.html` — the starter deck exercises every component, so it doubles as the test page for your hand-built skin. Iterate per [the method](method.md#5-the-iteration-loop-spot-check-by-eye).

The result is byte-for-byte the same kind of deck folder extraction produces — `build.mjs acme` neither knows nor cares how the skin was made.
