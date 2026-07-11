#!/usr/bin/env node
/* Extract a brand skin from a company website and scaffold a deck.
   Fetches the homepage plus its stylesheets, mines them for colors, fonts,
   logo candidates, an icon system, and corner radii, then writes
   decks/<name>/ with the starter slides, a filled-in tokens.css skin
   (every machine judgment marked TODO(spot-check)), self-hosted fonts,
   downloaded logo candidates, and a brand-report.json audit trail.
   Ends with a site-readiness scorecard so you know how much manual
   polish the skin still needs before the deck looks like the brand.

   Parsing is regex-based on purpose: zero dependencies, and it works on
   the large majority of marketing sites whose brand lives in plain CSS.
   Known limits (all deliberate): no JS execution, so fully client-rendered
   sites yield thin signals (the scorecard says so); no named-color /
   oklch() / color-mix() parsing; style="" attributes are ignored; the
   rule tokenizer attributes @media-nested rules to their inner selectors.

   Usage:  node extract.mjs <url> [--name <deck-name>] [--force]
   Output: decks/<name>/{index.html, tokens.css, assets/, fonts/,
           brand-report.json}                                              */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoDir = path.dirname(fileURLToPath(import.meta.url));
const decksDir = path.join(repoDir, 'decks');
const starterDir = path.join(decksDir, 'starter');

const FETCH_TIMEOUT_MS = 10_000;
const MAX_SHEETS = 25;
const MAX_SHEET_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const WEIGHT_SLOTS = [400, 500, 600, 700, 800];
// Colors painted at low alpha are overlays/scrims/borders, not brand paint —
// they'd drag phantom hues into the palette, so they're skipped.
const MIN_ALPHA = 0.4;
// Google Fonts sniffs the UA and only serves woff2 @font-face to modern
// browsers — an anonymous UA gets ttf (or nothing), so we impersonate Chrome.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const USAGE = `Usage: node extract.mjs <url> [--name <deck-name>] [--force]

  Fetches <url> (https:// assumed if no scheme), mines the site's CSS for
  brand signals, and scaffolds decks/<name>/ with tokens.css, self-hosted
  fonts, logo candidates, and a brand-report.json.

  --name   deck folder name (default: first label of the registrable domain,
           e.g. https://www.example.co.uk -> example)
  --force  overwrite an existing decks/<name>/ scaffold, including index.html`;

/* ── CLI ──────────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const args = { url: null, name: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--name') {
      args.name = argv[++i];
      if (!args.name) throw new Error(`--name requires a value\n\n${USAGE}`);
    } else if (a.startsWith('--')) throw new Error(`unknown flag ${a}\n\n${USAGE}`);
    else if (!args.url) args.url = a;
    else throw new Error(`unexpected argument ${a}\n\n${USAGE}`);
  }
  if (!args.url) throw new Error(USAGE);
  if (!/^https?:\/\//i.test(args.url)) args.url = `https://${args.url}`;
  if (args.name && !/^[a-z0-9][a-z0-9_-]*$/i.test(args.name))
    throw new Error(`--name must be a simple folder name (letters/digits/-/_), got "${args.name}"`);
  return args;
}

// First label of the registrable domain. Not a full Public Suffix List —
// just the common two-part ccTLD shapes (co.uk, com.au, ...). Pass --name
// when this guesses wrong.
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac']);
function defaultDeckName(urlStr) {
  const host = new URL(urlStr).hostname.replace(/^www\./i, '');
  const parts = host.split('.');
  let label = parts[0];
  if (parts.length >= 3 && parts.at(-1).length <= 3 && SECOND_LEVEL.has(parts.at(-2)))
    label = parts.at(-3);
  else if (parts.length >= 2) label = parts.at(-2);
  return label.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/* ── Fetch helpers ────────────────────────────────────────────────────────── */

async function fetchRaw(url, { accept = '*/*', maxBytes = MAX_ASSET_BYTES, truncate = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept, 'accept-language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
    let buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      if (!truncate) throw new Error(`response too large (${buf.length} bytes > ${maxBytes} cap)`);
      buf = buf.subarray(0, maxBytes); // partial CSS beats no CSS; may chop mid-rule
    }
    return {
      buf,
      finalUrl: res.url || url,
      contentType: (res.headers.get('content-type') || '').toLowerCase(),
      truncated: truncate && buf.length === maxBytes,
    };
  } catch (err) {
    throw new Error(describeFetchError(err, url), { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, opts = {}) {
  const r = await fetchRaw(url, opts);
  return { ...r, text: r.buf.toString('utf8') };
}

function describeFetchError(err, url) {
  const code = err?.cause?.code || err?.code || '';
  if (err.name === 'AbortError' || code === 'ABORT_ERR')
    return `timed out after ${FETCH_TIMEOUT_MS / 1000}s: ${url}`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
    return `DNS lookup failed for ${url} — is the domain spelled right?`;
  if (code === 'ECONNREFUSED') return `connection refused: ${url}`;
  if (/CERT|TLS|SSL/i.test(code) || /certificate/i.test(err.message || ''))
    return `TLS/certificate problem fetching ${url} (${code || err.message})`;
  return `${err.message}${code ? ` (${code})` : ''}: ${url}`;
}

/* ── Small HTML helpers ───────────────────────────────────────────────────── */

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Value of one attribute inside a raw tag string ('' when absent).
function attrOf(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`, 'i'));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim() : '';
}

// <meta name|property="key" content="..."> lookup, attribute-order agnostic.
function metaContent(html, key) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const k = (attrOf(tag, 'name') || attrOf(tag, 'property')).toLowerCase();
    if (k === key) return attrOf(tag, 'content');
  }
  return '';
}

function sanitizeFilename(name) {
  return decodeURIComponent(name).replace(/[?#].*$/, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
}

/* ── Color math ───────────────────────────────────────────────────────────── */

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s, l };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255].map(Math.round);
}

const hslToHex = (h, s, l) => rgbToHex(...hslToRgb(h, s, l));
const hexHsl = (hex) => rgbToHsl(...hexToRgb(hex));

// t of the way from a to b (t=0 -> a, t=1 -> b), straight RGB lerp.
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(...A.map((v, i) => v + (B[i] - v) * t));
}

function withLightness(hex, l) {
  const { h, s } = hexHsl(hex);
  return hslToHex(h, s, clamp(l, 0, 1));
}

const darken = (hex, amt) => withLightness(hex, hexHsl(hex).l * (1 - amt));
const lighten = (hex, amt) => withLightness(hex, hexHsl(hex).l + amt);

function hueDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Perceived brightness 0-255 (YIQ); used to pick text color on the primary.
function yiq(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

const rgbTriple = (hex) => hexToRgb(hex).join(', ');

/* Parse a CSS color literal to { hex, alpha }. Named colors, oklch(),
   lab(), and color-mix() are out of scope for a regex extractor — they
   return null and simply don't count toward the palette. */
function parseColor(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { hex: `#${h.slice(0, 6)}`, alpha };
  }
  m = s.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/);
  if (m) {
    const ch = (v) => (v.endsWith('%') ? (parseFloat(v) * 255) / 100 : parseFloat(v));
    return { hex: rgbToHex(ch(m[1]), ch(m[2]), ch(m[3])), alpha: parseAlpha(m[4]) };
  }
  m = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/);
  if (m) return { hex: hslToHex(parseFloat(m[1]), parseFloat(m[2]) / 100, parseFloat(m[3]) / 100), alpha: parseAlpha(m[4]) };
  return null;
}

function parseAlpha(v) {
  if (v == null) return 1;
  return clamp(v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v), 0, 1);
}

/* ── Palette accumulation & role selection ────────────────────────────────── */

// palette: Map<hex, { hex, count, sheets:Set, propNames:Set, contexts:Set }>
function addColor(palette, hex, sheet, { propName, context, weight = 1 } = {}) {
  let e = palette.get(hex);
  if (!e) {
    e = { hex, count: 0, sheets: new Set(), propNames: new Set(), contexts: new Set() };
    palette.set(hex, e);
  }
  e.count += weight;
  if (sheet) e.sheets.add(sheet);
  if (propName) e.propNames.add(propName);
  for (const c of [].concat(context ?? [])) e.contexts.add(c);
}

const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;
// "Looks like a button or link" selector test — colors set there are strong
// primary-brand evidence.
const BUTTONISH_SEL = /(^|[\s,>+~(])(a|button)($|[\s,>+~:.#[)])|\.(btn|button|cta)[\w-]*/i;

/* Scan one stylesheet into the accumulator. The block tokenizer only
   matches brace-balanced leaf rules, so rules nested in @media/@supports
   are found (attributed to their inner selector); the at-rule prelude
   itself never matches. */
function scanCss(css, label, acc) {
  for (const m of css.matchAll(/--([\w-]+)\s*:\s*([^;{}]+)/g)) {
    const c = parseColor(m[2].trim());
    if (!c) continue;
    if (!(`--${m[1]}` in acc.customProps)) acc.customProps[`--${m[1]}`] = c.hex;
    if (c.alpha >= MIN_ALPHA) addColor(acc.palette, c.hex, label, { propName: m[1] });
  }
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const isBtn = BUTTONISH_SEL.test(m[1]);
    // custom-prop declarations were counted above — strip to avoid doubles
    const body = m[2].replace(/--[\w-]+\s*:[^;]*/g, '');
    // Per-declaration so background colors can be tagged: dark *backgrounds*
    // are the dark-register signal (inks outnumber them but don't qualify).
    // Splitting on ';' chops data: URIs mid-value; harmless — base64 text
    // can't contain a color literal.
    for (const decl of body.split(';')) {
      const ci = decl.indexOf(':');
      if (ci < 0) continue;
      const prop = decl.slice(0, ci).trim().toLowerCase();
      const contexts = [];
      if (isBtn) contexts.push('button/link');
      if (/^background(-color|-image)?$/.test(prop)) contexts.push('background');
      for (const lit of decl.slice(ci + 1).match(COLOR_LITERAL) || []) {
        const c = parseColor(lit);
        if (!c || c.alpha < MIN_ALPHA) continue;
        addColor(acc.palette, c.hex, label, { context: contexts });
      }
    }
    // brand colors are often applied via var(--x) in button rules — remember
    // the referenced prop names and credit their colors after all sheets scan
    if (isBtn) for (const vm of body.matchAll(/var\(\s*--([\w-]+)/g)) acc.btnPropRefs.add(vm[1]);
  }
}

function creditButtonProps(acc) {
  for (const name of acc.btnPropRefs) {
    const hex = acc.customProps[`--${name}`];
    if (hex && acc.palette.has(hex)) acc.palette.get(hex).contexts.add('button/link');
  }
}

const BRAND_PROP = /brand|primary|accent|theme|main/i;

/* Framework stock palettes. Finding #0d6efd proves a site ships Bootstrap,
   not that its brand is Bootstrap blue — a rebranded build would compile
   different hex values — so these are excluded from primary/accent/success
   selection. Neutrals are never excluded: a stock-Bootstrap site really
   does look #212529-ink. Tailwind colors are deliberately NOT listed —
   Tailwind compiles only the classes a site uses, so its palette values
   are chosen, not shipped. */
const FRAMEWORK_STOCK_HEXES = new Set([
  // Bootstrap 5
  '#0d6efd', '#6610f2', '#6f42c1', '#d63384', '#dc3545', '#fd7e14', '#ffc107',
  '#198754', '#20c997', '#0dcaf0', '#0a58ca',
  // Bootstrap 4
  '#007bff', '#e83e8c', '#28a745', '#17a2b8',
  // Foundation / Bulma primaries
  '#1779ba', '#00d1b2',
  // Swiper carousel theme blue
  '#007aff',
]);
// Framework-plumbing custom props. Tailwind is namespace-excluded only for
// the props whose *values* ship as stock defaults in every build
// (--tw-ring-color's blue, --tw-ring-offset-color, the typography plugin's
// --tw-prose-* grays); props like --tw-gradient-from or --tw-shadow-color
// carry site-chosen colors and stay eligible.
const FRAMEWORK_NS = /^(bs|mdb|bulma|chakra|uk|swiper)-|^tw-(ring-color|ring-offset-color|prose-)/;

function isFrameworkDefault(e) {
  if (FRAMEWORK_STOCK_HEXES.has(e.hex)) return true;
  // Colors that only ever appear through framework-namespaced custom props
  // and never in real button/theme usage are framework plumbing too
  // (e.g. Bootstrap's --bs-success-text-emphasis tints).
  return (
    e.propNames.size > 0 &&
    [...e.propNames].every((n) => FRAMEWORK_NS.test(n)) &&
    !e.contexts.has('button/link') &&
    !e.contexts.has('theme-color')
  );
}

/* Perceptual chroma proxy: HSL saturation inflates near black/white (a
   near-black like s=0.39, l=0.11 reads as "saturated"), so colorfulness is
   judged as s * min(l, 1-l) — equivalent to half the RGB max-min spread.
   Vivid mids score ~0.2-0.5; dark neutrals fall well under 0.09. */
const chromaOf = ({ s, l }) => s * Math.min(l, 1 - l);
const MIN_BRAND_CHROMA = 0.09;

function scoreEntry(e) {
  let score = Math.log2(e.count + 1);
  if ([...e.propNames].some((n) => BRAND_PROP.test(n))) score += 6;
  if (e.contexts.has('theme-color')) score += 5;
  if (e.contexts.has('button/link')) score += 3;
  // Colorfulness weighs in, not just as a pass/fail gate: a clearly vivid
  // hue (chroma >= 0.2 -> +4) outranks a borderline muted one (~0.09 ->
  // +1.8) even when the muted one is used more often. The boost saturates
  // at 0.2 so that among genuinely vivid candidates, frequency and usage
  // evidence decide — not raw vividness.
  score += 4 * Math.min(1, chromaOf(e.hsl) / 0.2);
  // A color repeated across independent stylesheets (inline blocks AND
  // compiled bundles) is site-wide paint, not an incidental literal.
  score += 0.5 * Math.min(e.sheets.size - 1, 2);
  return score;
}

function evidenceOf(e) {
  const bits = [`used ${e.count}x`];
  const props = [...e.propNames].filter((n) => BRAND_PROP.test(n));
  if (props.length) bits.push(`custom prop --${props[0]}`);
  if (e.contexts.has('theme-color')) bits.push('<meta theme-color>');
  if (e.contexts.has('button/link')) bits.push('button/link rules');
  return bits.join(', ');
}

/* Turn the raw palette into the token roles. Every judgment call lands in
   role.why so tokens.css and brand-report.json can show their work. */
function chooseRoles(palette, warnings) {
  const entries = [...palette.values()].map((e) => ({ ...e, hsl: hexHsl(e.hex) }));

  // Ink (light-theme text) is decided first — most frequent dark
  // low-ish-saturation color — because whatever wins the text role is
  // disqualified from the primary role below (a color can't be both the
  // body ink and the brand accent).
  const darks = entries
    .filter((e) => e.hsl.l <= 0.3 && e.hsl.s <= 0.45)
    .sort((a, b) => b.count - a.count);
  const inkSampled = darks[0]?.hex ?? null;

  const isSaturated = ({ hsl }) => chromaOf(hsl) >= MIN_BRAND_CHROMA && hsl.l <= 0.92;
  const saturated = entries
    .filter(isSaturated)
    .filter((e) => e.hex !== inkSampled)
    .map((e) => ({ ...e, score: scoreEntry(e) }))
    .sort((a, b) => b.score - a.score);
  const brandPool = saturated.filter((e) => !isFrameworkDefault(e));
  const pool = brandPool.length ? brandPool : saturated;

  const roles = { fallbackPrimary: false, syntheticAccents: 0 };
  roles.frameworkExcluded = saturated.length - brandPool.length;
  if (saturated.length && !brandPool.length)
    warnings.push('every saturated color looks like a framework default — primary chosen from them anyway; spot-check hard');
  else if (roles.frameworkExcluded)
    warnings.push(`${roles.frameworkExcluded} framework-default color(s) excluded from brand-role selection`);

  // Primary — highest-scoring saturated color, deepened if too light to
  // carry labels on white (both reference skins made this same move).
  if (pool.length) {
    const top = pool[0];
    roles.primarySampled = top.hex;
    roles.primary = top.hsl.l > 0.6 ? withLightness(top.hex, 0.48) : top.hex;
    roles.primaryWhy =
      evidenceOf(top) + (roles.primary !== top.hex ? `; deepened from ${top.hex} for contrast on white` : '');
  } else {
    roles.fallbackPrimary = true;
    roles.primarySampled = null;
    roles.primary = '#3b5bdb';
    roles.primaryWhy = 'PLACEHOLDER — no saturated brand color found in the site CSS';
    warnings.push('no saturated brand color found; tokens.css carries a placeholder primary');
  }

  // Accents 2-4 — next distinct hues (>= 30deg from everything chosen).
  const accents = [];
  const chosenHues = () => [roles.primary, ...accents.map((a) => a.hex)].map((h) => hexHsl(h).h);
  for (const cand of pool.slice(1)) {
    if (accents.length === 3) break;
    if (!chosenHues().every((h) => hueDist(h, cand.hsl.h) >= 30)) continue;
    const hex = cand.hsl.l > 0.68 ? withLightness(cand.hex, 0.52) : cand.hex;
    accents.push({ hex, why: evidenceOf(cand) + (hex !== cand.hex ? `; deepened from ${cand.hex}` : '') });
  }
  while (accents.length < 3) {
    // Mono-hue site: fill the remaining slots with deepened variants of what
    // we have, like the reference skins do for their "deep" accents.
    const base = accents.length ? accents[accents.length - 1].hex : roles.primary;
    accents.push({ hex: darken(base, 0.25), why: 'SYNTHESIZED — darkened variant, site exposes too few distinct hues', synthetic: true });
    roles.syntheticAccents++;
  }
  if (roles.syntheticAccents)
    warnings.push(`only ${3 - roles.syntheticAccents + 1} distinct brand hues found; ${roles.syntheticAccents} accent(s) synthesized as darker variants`);
  [roles.accent2, roles.accent3, roles.accent4] = accents;

  // Ink (light-theme text) — sampled above (before primary selection);
  // pure #000 is softened the way hand-made skins do.
  let ink = inkSampled ?? '#1f2124';
  roles.inkWhy = darks[0] ? `most frequent dark color (${evidenceOf(darks[0])})` : 'default — no dark text color found';
  if (hexHsl(ink).l < 0.08) {
    roles.inkWhy += `; softened from ${ink}`;
    ink = withLightness(ink, 0.1);
  }
  roles.ink = ink;

  // Dark register — most frequent very-dark color on the site (ones used as
  // backgrounds outrank inks of equal darkness), else a near-black derived
  // from the ink.
  const bgFirst = (a, b) =>
    b.contexts.has('background') - a.contexts.has('background') || b.count - a.count;
  const veryDark = entries.filter((e) => e.hsl.l <= 0.16).sort(bgFirst);
  roles.darkBg = veryDark[0]?.hex ?? withLightness(ink, 0.1);
  roles.darkWhy = veryDark[0]
    ? `most frequent very-dark ${veryDark[0].contexts.has('background') ? 'background' : 'color'} (${evidenceOf(veryDark[0])})`
    : 'DERIVED — no very-dark color found; near-black from the ink color';
  if (hexHsl(roles.darkBg).l < 0.06) {
    // Pure black slabs read harsh on a slide — soften like a hand-made skin.
    roles.darkWhy += `; softened from ${roles.darkBg}`;
    roles.darkBg = withLightness(roles.darkBg, 0.1);
  }
  {
    const { h, s } = hexHsl(roles.darkBg);
    roles.darkText = hslToHex(h, Math.min(s, 0.3), 0.94);
    roles.stageBg = withLightness(roles.darkBg, Math.max(0.04, hexHsl(roles.darkBg).l * 0.55));
  }

  // Surfaces — most frequent light colors that aren't pure white, else a
  // faint tint of the primary.
  const lights = entries
    .filter((e) => e.hsl.l >= 0.9 && e.hex !== '#ffffff')
    .sort(bgFirst);
  roles.surface = lights[0]?.hex ?? mixHex(roles.primary, '#ffffff', 0.94);
  roles.surfaceAlt = lights[1]?.hex ?? darken(roles.surface, 0.05);
  if (hexHsl(roles.surfaceAlt).l > hexHsl(roles.surface).l)
    [roles.surface, roles.surfaceAlt] = [roles.surfaceAlt, roles.surface]; // alt is the deeper of the pair
  roles.surfaceWhy = lights[0]
    ? `most frequent light surface color (${evidenceOf(lights[0])})`
    : 'DERIVED — no off-white surface found; faint tint of the primary';

  // Semantic colors. Success borrows the site's green when it has one.
  const green = pool.find(
    (e) => e.hsl.h >= 85 && e.hsl.h <= 165 && e.hsl.s >= 0.25 && e.hsl.l >= 0.15 && e.hsl.l <= 0.65
  );
  roles.success = green ? withLightness(green.hex, Math.min(hexHsl(green.hex).l, 0.5)) : '#2e8b57';
  roles.successWhy = green ? `site green (${evidenceOf(green)})` : 'default sea-green — site exposes no green';
  roles.warning = '#a9690b'; // deep amber for the [TBD] marker, like the reference skins
  roles.error = '#c0392b';

  roles.onPrimary = yiq(roles.primary) >= 170 ? roles.ink : '#ffffff';
  roles.chart = [roles.primary, roles.accent2.hex, roles.ink];
  return roles;
}

/* ── Fonts ────────────────────────────────────────────────────────────────── */

// family specs out of a fonts.googleapis.com/css2?family=... URL.
// Handles "Name:wght@400;700", "Name:ital,wght@0,400;1,700" (ital=0 only),
// variable ranges "Name:wght@300..800", and multiple &family= params.
function parseGoogleCss2Url(u) {
  const out = [];
  const query = u.split('?')[1] || '';
  for (const part of query.split('&')) {
    if (!part.startsWith('family=')) continue;
    const spec = decodeURIComponent(part.slice(7)).replace(/\+/g, ' ');
    const [name, axes = ''] = spec.split(':');
    const weights = new Set();
    let range = null;
    const wm = axes.match(/wght@([^&:]*)/);
    if (wm) {
      for (const tuple of wm[1].split(';')) {
        const nums = tuple.split(',');
        const w = nums[nums.length - 1];
        if (nums.length > 1 && nums[0] !== '0') continue; // italic tuples
        if (w.includes('..')) {
          const [lo, hi] = w.split('..').map(Number);
          if (!isNaN(lo) && !isNaN(hi)) range = [lo, hi];
        } else if (!isNaN(parseInt(w, 10))) weights.add(parseInt(w, 10));
      }
    }
    if (name.trim()) out.push({ family: name.trim(), weights: [...weights].sort((a, b) => a - b), range });
  }
  return out;
}

const FONT_EXT = { woff2: 'woff2', woff: 'woff', truetype: 'ttf', opentype: 'otf', ttf: 'ttf', otf: 'otf' };
const FORMAT_STR = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };
const SRC_RANK = { woff2: 0, woff: 1, ttf: 2, otf: 3 };

// Best downloadable src of one @font-face body: woff2 > woff > ttf/otf.
// Supports base64 data: URIs; eot/svg fonts are skipped.
function pickFontSrc(body, baseUrl) {
  const srcs = [];
  for (const m of body.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)(?:\s*format\(\s*(['"]?)([^)'"]+)\3\s*\))?/gi)) {
    const raw = m[2].trim();
    let kind = (m[4] || '').toLowerCase();
    if (!kind) {
      kind = raw.startsWith('data:')
        ? (raw.match(/^data:(?:font|application)\/(?:x-font-)?(\w+)/i)?.[1] || '').toLowerCase()
        : path.extname(raw.split(/[?#]/)[0]).slice(1).toLowerCase();
    }
    const ext = FONT_EXT[kind];
    if (!ext) continue;
    let url = raw;
    if (!raw.startsWith('data:')) {
      try { url = new URL(raw, baseUrl).href; } catch { continue; }
    }
    srcs.push({ url, ext });
  }
  srcs.sort((a, b) => SRC_RANK[a.ext] - SRC_RANK[b.ext]);
  return srcs[0] || null;
}

/* All upright @font-face declarations in a CSS string.
   weight is a number or a [min, max] variable range; latin is true when the
   unicode-range covers basic latin (or is absent). */
function extractFontFaces(css, baseUrl) {
  const faces = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const body = m[1];
    const fm = body.match(/font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;}]+))/i);
    const family = (fm?.[1] ?? fm?.[2] ?? fm?.[3] ?? '').trim();
    if (!family) continue;
    const style = body.match(/font-style\s*:\s*(\w+)/i)?.[1]?.toLowerCase();
    if (style && style !== 'normal') continue; // decks use upright type only
    const wm = body.match(/font-weight\s*:\s*(\d+)(?:\s+(\d+))?/i);
    const weight = wm ? (wm[2] ? [+wm[1], +wm[2]] : +wm[1]) : 400;
    const ur = body.match(/unicode-range\s*:\s*([^;}]+)/i)?.[1];
    const src = pickFontSrc(body, baseUrl);
    if (!src) continue;
    faces.push({ family, weight, src, latin: !ur || /u\+0000/i.test(ur) });
  }
  return faces;
}

function weightDistance(weight, slot) {
  if (Array.isArray(weight)) {
    const [lo, hi] = weight;
    return slot >= lo && slot <= hi ? 0 : Math.min(Math.abs(slot - lo), Math.abs(slot - hi));
  }
  return Math.abs(weight - slot);
}

const weightLabel = (w) => (Array.isArray(w) ? `${w[0]}-${w[1]} (variable)` : String(w));

// For each token weight slot, the closest available face (may repeat).
function assignSlots(faces) {
  const plan = [];
  for (const slot of WEIGHT_SLOTS) {
    let best = null, bestD = Infinity;
    for (const f of faces) {
      const d = weightDistance(f.weight, slot);
      if (d < bestD) { bestD = d; best = f; }
    }
    if (best) plan.push({ slot, face: best, exact: bestD === 0 });
  }
  return plan;
}

async function resolveGoogleFaces(family) {
  const base = `https://fonts.googleapis.com/css2?family=${family.trim().replace(/ /g, '+')}`;
  const facesFrom = (cssText) =>
    extractFontFaces(cssText, 'https://fonts.googleapis.com/').filter((f) => f.latin);
  try {
    const { text } = await fetchText(`${base}:wght@${WEIGHT_SLOTS.join(';')}&display=swap`, { accept: 'text/css,*/*;q=0.1' });
    return facesFrom(text);
  } catch {
    // css2 rejects the whole request when any listed weight is missing from
    // the family — retry slot by slot and keep whatever exists.
    const faces = [];
    for (const w of WEIGHT_SLOTS) {
      try {
        const { text } = await fetchText(`${base}:wght@${w}&display=swap`, { accept: 'text/css,*/*;q=0.1' });
        faces.push(...facesFrom(text));
      } catch { /* this weight doesn't exist — fine */ }
    }
    return faces;
  }
}

/* Download one family's slot plan into decks/<name>/fonts/.
   Static cuts are named <Family>-<slot>.<ext> per the reference skins; when
   a slot falls back to the nearest cut, the substitution is recorded.
   Variable fonts (weight range like 100-900) — and any set of weight slots
   that a CDN answers with byte-identical payloads — collapse to ONE
   <Family>-var.<ext> file carrying a ranged @font-face, instead of five
   copies of the same bytes. Returns [{file, format, cssWeight, slots, ...}],
   one entry per @font-face to emit. */
async function downloadFamily(deckDir, family, faces, warnings) {
  const famFile = family.replace(/[^\w]+/g, '');
  const urlCache = new Map(); // src url -> bytes
  const groups = new Map(); // content hash -> one file on disk
  for (const { slot, face, exact } of assignSlots(faces)) {
    try {
      let buf = urlCache.get(face.src.url);
      if (!buf) {
        buf = face.src.url.startsWith('data:')
          ? dataUriBytes(face.src.url)
          : (await fetchRaw(face.src.url, { accept: '*/*' })).buf;
        urlCache.set(face.src.url, buf);
      }
      const hash = createHash('sha256').update(buf).digest('hex');
      let g = groups.get(hash);
      if (!g) {
        g = { buf, ext: face.src.ext, slots: [], range: null, declared: new Set(), exact: true };
        groups.set(hash, g);
      }
      g.slots.push(slot);
      if (Array.isArray(face.weight))
        g.range = g.range
          ? [Math.min(g.range[0], face.weight[0]), Math.max(g.range[1], face.weight[1])]
          : [...face.weight];
      else g.declared.add(face.weight);
      if (!exact) g.exact = false;
    } catch (err) {
      warnings.push(`font ${family} ${slot}: ${err.message}`);
    }
  }
  const files = [];
  const used = new Set();
  const uniqueName = (base, ext) => {
    let f = `${base}.${ext}`;
    for (let i = 2; used.has(f); i++) f = `${base}-${i}.${ext}`;
    used.add(f);
    return f;
  };
  for (const g of groups.values()) {
    const declared = [...g.declared].sort((a, b) => a - b);
    const slots = [...g.slots].sort((a, b) => a - b);
    // An explicit weight range means a variable font. So do identical bytes
    // declared under several different weights (CDNs answer per-weight
    // requests for a variable family with the same file). A single static
    // cut merely reused for nearby slots is NOT variable.
    const variable = !!g.range || declared.length > 1;
    if (variable) {
      const lo = g.range?.[0] ?? declared[0];
      const hi = g.range?.[1] ?? declared[declared.length - 1];
      const file = uniqueName(`${famFile}-var`, g.ext);
      fs.writeFileSync(path.join(deckDir, 'fonts', file), g.buf);
      files.push({
        file,
        format: FORMAT_STR[g.ext],
        cssWeight: `${lo} ${hi}`,
        slots,
        actualWeight: `${lo}-${hi} (variable)`,
        exact: g.exact,
      });
    } else {
      // One static cut, one file on disk; when it also covers other slots as
      // the nearest available cut, each slot keeps its own @font-face line
      // pointing at the shared file (same rendering, no duplicate bytes).
      const w = declared[0] ?? slots[0];
      const file = uniqueName(`${famFile}-${w}`, g.ext);
      fs.writeFileSync(path.join(deckDir, 'fonts', file), g.buf);
      for (const slot of slots)
        files.push({
          file,
          format: FORMAT_STR[g.ext],
          cssWeight: String(slot),
          slots: [slot],
          actualWeight: String(w),
          exact: slot === w,
        });
    }
  }
  return files;
}

function dataUriBytes(uri) {
  const m = uri.match(/^data:[^;,]+;base64,(.*)$/s);
  if (!m) throw new Error('unsupported data: URI encoding (not base64)');
  return Buffer.from(m[1], 'base64');
}

/* Font-family stacks used across the sheets, split into heading vs body
   evidence by selector. Also picks up font-ish custom props
   (--font-heading, --default-font, ...) since many sites route type
   through variables. */
function extractFontStacks(sheets) {
  const stacks = new Map(), heading = new Map(), body = new Map();
  const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  for (const s of sheets) {
    for (const m of s.css.matchAll(/--([\w-]*(?:font|family|face)[\w-]*)\s*:\s*([^;{}]+)/gi)) {
      const stack = m[2].trim().replace(/\s+/g, ' ');
      if (/var\(|inherit|initial|unset|^\d/.test(stack)) continue;
      bump(stacks, stack);
      if (/head|display|title/i.test(m[1])) bump(heading, stack);
      if (/body|base|default|text/i.test(m[1])) bump(body, stack);
    }
    for (const m of s.css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1];
      for (const fm of m[2].matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
        const stack = fm[1].trim().replace(/\s+/g, ' ');
        if (/var\(|inherit|initial|unset/.test(stack)) continue;
        bump(stacks, stack);
        if (/(^|[\s,])h[1-3]\b|heading|title|display|hero/i.test(sel)) bump(heading, stack);
        if (/(^|[\s,])(body|html)\b|(^|[\s,])p\b/i.test(sel)) bump(body, stack);
      }
    }
  }
  return { stacks, heading, body };
}

// Web-safe/system names that shouldn't win "the brand face" unless the site
// actually self-hosts or Google-loads them.
const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', '-apple-system',
  'blinkmacsystemfont', 'segoe ui', 'segoe ui emoji', 'segoe ui symbol',
  'roboto', 'helvetica', 'helvetica neue', 'arial', 'verdana', 'georgia',
  'times', 'times new roman', 'courier', 'courier new', 'menlo', 'monaco',
  'consolas', 'sf mono', 'sfmono-regular', 'liberation sans',
  'liberation mono', 'liberation serif', 'noto sans', 'noto serif',
  'apple color emoji', 'noto color emoji', 'noto emoji',
  'inherit', 'initial', 'unset',
]);

// First "real" family name of a stack string ('Poppins', sans-serif -> Poppins).
function firstRealFamily(stack, knownReal) {
  for (let name of stack.split(',')) {
    name = name.trim().replace(/^["']|["']$/g, '').trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (!GENERIC_FAMILIES.has(lower) || knownReal.has(lower)) return name;
  }
  return null;
}

const topKey = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

/* Decide the display / body / mono families from all font evidence. */
function pickFamilies({ stacks, heading, body }, knownReal, warnings) {
  const pick = (map) => {
    for (const [stack] of [...map.entries()].sort((a, b) => b[1] - a[1])) {
      const fam = firstRealFamily(stack, knownReal);
      if (fam) return fam;
    }
    return null;
  };
  const overall = pick(stacks);
  const display = pick(heading) ?? overall;
  // When no real body family survives the generic-name filter (system-stack
  // bodies are common), the display face is a better body than a
  // symbol/emoji tail from the stack.
  const bodyFam = pick(body) ?? overall ?? display;
  // A monospace stack anywhere on the site claims --font-mono; otherwise the
  // deck maps mono onto the body face (the reference-skin move).
  let mono = null;
  for (const [stack] of stacks) {
    if (!/monospace|\bmono\b|menlo|consolas|courier|source code|jetbrains|fira code|ibm plex mono/i.test(stack)) continue;
    mono = firstRealFamily(stack, knownReal);
    if (mono) break;
  }
  if (!display && !bodyFam) warnings.push('no non-generic font family found in the site CSS');
  return { display, body: bodyFam, mono };
}

/* ── Logo candidates ──────────────────────────────────────────────────────── */

/* Score logo-looking references in the HTML. Additive evidence: "logo" in
   the src beats "logo" in a class beats merely living in the header. Nested
   <nav> inside <header> makes the range match lazy/approximate — that only
   costs a +2 heuristic point, never a candidate. */
function collectLogoCandidates(html, baseUrl) {
  const cands = new Map();
  const add = (raw, score, reason) => {
    if (!raw || raw.startsWith('data:')) return;
    let resolved;
    try { resolved = new URL(raw, baseUrl).href; } catch { return; }
    if (!/^https?:/.test(resolved)) return;
    let e = cands.get(resolved);
    if (!e) { e = { url: resolved, score: 0, reasons: new Set() }; cands.set(resolved, e); }
    e.score += score;
    e.reasons.add(reason);
  };

  const headerRanges = [...html.matchAll(/<(header|nav)\b[\s\S]*?<\/\1>/gi)]
    .map((m) => [m.index, m.index + m[0].length]);

  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attrOf(tag, 'src') || attrOf(tag, 'data-src') || attrOf(tag, 'data-lazy-src');
    if (!src) continue;
    const idc = `${attrOf(tag, 'class')} ${attrOf(tag, 'id')} ${attrOf(tag, 'alt')}`;
    if (/logo/i.test(src)) add(src, 4, 'src mentions "logo"');
    if (/logo/i.test(idc)) add(src, 3, 'class/id/alt mentions "logo"');
    if (headerRanges.some(([a, b]) => m.index > a && m.index < b)) add(src, 2, 'inside <header>/<nav>');
    if (/\.svg([?#]|$)/i.test(src) && cands.has(safeResolve(src, baseUrl))) add(src, 2, 'SVG (scales cleanly)');
  }

  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attrOf(m[0], 'rel').toLowerCase();
    const href = attrOf(m[0], 'href');
    if (!href || !rel.includes('icon')) continue;
    if (rel.includes('apple-touch-icon')) add(href, 2, 'apple-touch-icon');
    else add(href, /\.svg([?#]|$)/i.test(href) ? 3 : 1, 'rel=icon');
  }

  const og = metaContent(html, 'og:image');
  if (og) add(og, 1, 'og:image (often a social card, not the logo)');

  return [...cands.values()]
    .map((e) => ({ ...e, reasons: [...e.reasons] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function safeResolve(raw, base) {
  try { return new URL(raw, base).href; } catch { return null; }
}

const EXT_FROM_CT = {
  'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg',
  'image/webp': 'webp', 'image/gif': 'gif', 'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico', 'image/avif': 'avif',
};

/* Download the candidates into assets/ and copy the best to assets/logo.<ext>.
   Pixel dimensions are read only where a decoder is trivial (PNG/GIF header
   fields, SVG viewBox); everything else is honestly "unknown". */
async function downloadLogos(deckDir, candidates, warnings) {
  const saved = [];
  const used = new Set(fs.readdirSync(path.join(deckDir, 'assets')));
  for (const c of candidates) {
    try {
      const { buf, contentType } = await fetchRaw(c.url, { accept: 'image/*,*/*;q=0.5' });
      let base = sanitizeFilename(path.basename(new URL(c.url).pathname)) || 'logo-candidate';
      let ext = path.extname(base).slice(1).toLowerCase();
      if (!ext) {
        ext = EXT_FROM_CT[contentType.split(';')[0].trim()] || 'img';
        base += `.${ext}`;
      }
      let file = base;
      for (let i = 2; used.has(file); i++) file = base.replace(/(\.\w+)$/, `-${i}$1`);
      used.add(file);
      fs.writeFileSync(path.join(deckDir, 'assets', file), buf);
      saved.push({
        ...c,
        savedAs: `assets/${file}`,
        ext,
        bytes: buf.length,
        dimensions: imageDims(buf, ext) ?? 'unknown',
      });
    } catch (err) {
      warnings.push(`logo candidate ${c.url}: ${err.message}`);
    }
  }
  if (saved.length) {
    const best = saved[0]; // highest score that actually downloaded
    const logoName = `logo.${best.ext}`;
    fs.copyFileSync(path.join(deckDir, best.savedAs), path.join(deckDir, 'assets', logoName));
    best.bestGuess = `assets/${logoName}`;
  }
  return saved;
}

function imageDims(buf, ext) {
  try {
    if (ext === 'png' && buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47)
      return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
    if (ext === 'gif' && buf.subarray(0, 4).toString() === 'GIF8')
      return `${buf.readUInt16LE(6)}x${buf.readUInt16LE(8)}`;
    if (ext === 'svg') {
      const s = buf.toString('utf8', 0, 2048);
      const vb = s.match(/viewBox\s*=\s*["']([\d.\s-]+)["']/i);
      if (vb) return `viewBox ${vb[1].trim().replace(/\s+/g, ' ')}`;
    }
  } catch { /* fall through to unknown */ }
  return null; // jpeg/webp/ico dims need real decoders
}

/* ── Icon system detection ────────────────────────────────────────────────── */

const ICON_SYSTEMS = [
  { name: 'bootstrap-icons', href: /bootstrap-icons/i, cls: /(?:^|\s)bi(?:\s+|-)[a-z0-9-]+/ },
  { name: 'font-awesome', href: /font-?awesome|kit\.fontawesome\.com/i, cls: /(?:^|\s)fa(?:[srlbd]|-solid|-regular|-light|-brands|-duotone)?\s+fa-[a-z0-9-]+/ },
  { name: 'material-symbols', href: /Material\+Symbols|Material\+Icons/i, cls: /material-(?:symbols|icons)/ },
  { name: 'lucide', href: /lucide/i, cls: /data-lucide=/ },
  { name: 'heroicons', href: /heroicons/i, cls: null }, // usually inlined SVG — URL evidence only
  { name: 'phosphor', href: /phosphor/i, cls: /(?:^|\s)ph(?:-(?:bold|fill|duotone|light|thin))?\s+ph-[a-z-]+/ },
];

function detectIconSystems(html, sheets) {
  const urlBlob = [
    ...[...html.matchAll(/<link\b[^>]*>|<script\b[^>]*>/gi)].map((m) => m[0]),
    ...sheets.map((s) => s.url || ''),
  ].join('\n');
  const classBlob =
    [...html.matchAll(/class\s*=\s*["']([^"']*)["']/gi)].map((m) => ` ${m[1]}`).join('') +
    (html.includes('data-lucide=') ? ' data-lucide=' : '');
  const found = [];
  for (const sys of ICON_SYSTEMS) {
    if (sys.href.test(urlBlob)) found.push({ name: sys.name, evidence: 'stylesheet/script URL' });
    else if (sys.cls && sys.cls.test(classBlob)) found.push({ name: sys.name, evidence: 'class names in the HTML' });
  }
  return found;
}

/* ── Corner radii ─────────────────────────────────────────────────────────── */

/* Histogram of border-radius values (px; rem/em taken at 16px). Hairlines
   (<2px) and pill/circle radii (>40px, %, 9999px) are card *shape* noise,
   not shape language, and are skipped. */
function extractRadii(sheets) {
  const hist = new Map();
  for (const s of sheets) {
    for (const m of s.css.matchAll(/border-radius\s*:\s*([^;}]+)/gi)) {
      for (const tok of m[1].trim().split(/[\s/]+/)) {
        const pm = tok.match(/^([\d.]+)(px|rem|em)$/);
        if (!pm) continue;
        const px = Math.round(parseFloat(pm[1]) * (pm[2] === 'px' ? 1 : 16));
        if (px < 2 || px > 40) continue;
        hist.set(px, (hist.get(px) || 0) + 1);
      }
    }
  }
  const mode = (lo, hi, dflt) => {
    let best = null, bestN = 0;
    for (const [px, n] of hist) if (px >= lo && px <= hi && n > bestN) { best = px; bestN = n; }
    return best ?? dflt;
  };
  return {
    histogram: [...hist.entries()].sort((a, b) => b[1] - a[1]).map(([px, count]) => ({ px, count })),
    chosen: { sm: mode(2, 9, 8), md: mode(10, 15, 14), lg: mode(16, 40, 18) },
    found: hist.size > 0,
  };
}

/* ── JS-rendered page detection ───────────────────────────────────────────── */

/* "JS-rendered" is claimed only on positive framework evidence — an empty
   root shell div, hydration markers, or a script payload that dwarfs the
   visible text. A tiny page that is merely tiny (example.com) gets a softer
   thin-content note instead. */
function assessJsRendered(html, sheets) {
  const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  const text = bodyHtml
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const rootShell = /<div[^>]+id=["'](?:root|app|__next|___gatsby|q-app)["'][^>]*>\s*<\/div>/i.test(html);
  const hydrationMarkers =
    /\bdata-reactroot\b|\bdata-server-rendered\b|\bng-version\s*=|\bdata-v-app\b|__NEXT_DATA__|__NUXT__|<astro-island|\bdata-svelte(?:-h)?\b|\bdata-hydrate\b/i.test(
      html
    );
  let scriptChars = 0;
  let externalScripts = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    scriptChars += m[2].length;
    if (/\bsrc\s*=/i.test(m[1])) externalScripts++;
  }
  const heavyScripts = scriptChars > Math.max(5000, 10 * text.length) || externalScripts >= 4;
  const thin = text.length < 250;
  const cssBytes = sheets.reduce((n, s) => n + s.css.length, 0);
  return {
    likely: thin && (rootShell || hydrationMarkers || heavyScripts),
    thinContent: thin,
    visibleTextChars: text.length,
    rootShell,
    hydrationMarkers,
    scriptChars,
    externalScripts,
    cssBytes,
  };
}

/* ── Scaffolding ──────────────────────────────────────────────────────────── */

// Pure conflict check — run before any network work so a doomed run fails
// in milliseconds and leaves nothing behind.
function checkDeckWritable(name, force) {
  for (const f of ['index.html', 'tokens.css']) {
    if (!force && fs.existsSync(path.join(decksDir, name, f)))
      throw new Error(
        `decks/${name}/${f} already exists — pick another --name or pass --force to overwrite the scaffold`
      );
  }
}

function scaffoldDeck(name, warnings) {
  const deckDir = path.join(decksDir, name);
  fs.mkdirSync(path.join(deckDir, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(deckDir, 'fonts'), { recursive: true });

  // Starter slides + placeholder assets keep the deck building until the
  // user swaps in real content; downloaded brand assets land alongside.
  const starterIndex = path.join(starterDir, 'index.html');
  if (fs.existsSync(starterIndex)) {
    fs.copyFileSync(starterIndex, path.join(deckDir, 'index.html'));
  } else {
    warnings.push('decks/starter/index.html not found — scaffold has no slides yet; copy a deck to start from');
  }
  const starterAssets = path.join(starterDir, 'assets');
  if (fs.existsSync(starterAssets)) {
    fs.cpSync(starterAssets, path.join(deckDir, 'assets'), { recursive: true });
  }
  return deckDir;
}

/* ── tokens.css template ──────────────────────────────────────────────────── */

const FALLBACK_STACK = `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
const MONO_FALLBACK = `ui-monospace, 'SF Mono', Menlo, monospace`;

function renderTokens({ name, site, date, roles, fonts, radii }) {
  const U = (h) => h.toUpperCase();
  const title = name[0].toUpperCase() + name.slice(1);
  const host = new URL(site).hostname;
  const inkRgb = rgbTriple(roles.ink);
  const darkTextRgb = rgbTriple(roles.darkText);
  const a2 = roles.accent2, a3 = roles.accent3, a4 = roles.accent4;

  const faceLines = fonts.faceCss.length
    ? fonts.faceCss.join('\n')
    : `/* No self-hostable fonts could be downloaded from the site. The stacks
   below fall back to system faces — the deck still builds, it just won't
   have the brand's type. Drop woff2 files (weights 400-800) into ./fonts/
   and add @font-face lines here. See docs/website-requirements.md ("Fonts"). */`;

  const stack = (fam) => (fam ? `'${fam}', ${FALLBACK_STACK}` : FALLBACK_STACK);
  const monoStack = fonts.mono ? `'${fonts.mono}', ${MONO_FALLBACK}` : stack(fonts.body);
  const monoWhy = fonts.mono
    ? `site uses ${fonts.mono} for code; not self-hosted — falls back to system mono offline`
    : 'no mono face on the site, so mono maps to the body face (labels stay on-brand)';

  return `/* ── ${title} deck tokens ─────────────────────────────────────────────────────
   Brand skin for the shared deck engine, generated by extract.mjs from
   ${site} on ${date}. Every value below was sampled from the
   site's CSS or derived from a sampled value; lines marked TODO(spot-check)
   are machine judgment calls. Open the deck next to the live site, confirm
   each one, then delete the TODO comments. */

${faceLines}

:root {
  /* Color — light theme sampled from ${host} */
  --color-background: #FFFFFF;
  --color-surface: ${U(roles.surface)};   /* TODO(spot-check): ${roles.surfaceWhy} */
  --color-surface-alt: ${U(roles.surfaceAlt)};
  --color-border: rgba(${inkRgb}, 0.12);
  --color-border-strong: rgba(${inkRgb}, 0.22);
  --color-text: ${U(roles.ink)};   /* TODO(spot-check): ${roles.inkWhy} */
  --color-text-muted: rgba(${inkRgb}, 0.72);
  --color-text-faint: rgba(${inkRgb}, 0.48);
  --color-primary: ${U(roles.primary)};   /* TODO(spot-check): ${roles.primaryWhy} */
  --color-primary-dark: ${U(darken(roles.primary, 0.15))};   /* derived: primary darkened ~15% */
  --color-primary-light: ${U(mixHex(roles.primary, '#ffffff', 0.88))};   /* derived: primary mixed 88% toward white */
  --color-primary-tint: ${U(lighten(roles.primary, 0.2))};   /* derived: primary lightened ~20% (for the dark register) */
  --color-on-primary: ${U(roles.onPrimary)};
  --color-success: ${U(roles.success)};   /* TODO(spot-check): ${roles.successWhy} */
  --color-warning: ${U(roles.warning)};   /* [TBD] marker — deep amber, keep it distinct from the primary */
  --color-error: ${U(roles.error)};

  /* Accents (chips, card top-borders, photo cards) */
  --accent: var(--color-primary);
  --accent-2: ${U(a2.hex)};   /* TODO(spot-check): ${a2.why} */
  --accent-3: ${U(a3.hex)};   /* TODO(spot-check): ${a3.why} */
  --accent-4: ${U(a4.hex)};   /* TODO(spot-check): ${a4.why} */

  /* RGB triples for photo-card gradient overlays (.pcard.p-1 / .p-2 / .p-3) */
  --accent-rgb: ${rgbTriple(roles.primary)};
  --accent-deep-rgb: ${rgbTriple(darken(roles.primary, 0.3))};
  --accent-2-rgb: ${rgbTriple(a2.hex)};
  --accent-2-deep-rgb: ${rgbTriple(darken(a2.hex, 0.3))};
  --accent-3-rgb: ${rgbTriple(a3.hex)};

  /* Chart series — brand-adjacent; check they stay separable for CVD readers */
  --chart-1: ${U(roles.chart[0])};
  --chart-2: ${U(roles.chart[1])};
  --chart-3: ${U(roles.chart[2])};

  /* Dark register (stat banner, cover, phone frame, closing) */
  --dark-bg: ${U(roles.darkBg)};   /* TODO(spot-check): ${roles.darkWhy} */
  --dark-text: ${U(roles.darkText)};
  --dark-muted: rgba(${darkTextRgb}, 0.66);
  --dark-border: rgba(${darkTextRgb}, 0.16);

  /* Type${fonts.display ? ` — ${fonts.display}${fonts.body && fonts.body !== fonts.display ? ` display over ${fonts.body} body` : ' throughout'}` : ''} */
  --font-display: ${stack(fonts.display)};${fonts.display ? '' : '   /* TODO(spot-check): no brand face identified */'}
  --font-body: ${stack(fonts.body)};
  --font-mono: ${monoStack};   /* TODO(spot-check): ${monoWhy} */

  /* Shape — ${radii.found ? "sampled from the site's border-radius usage" : 'defaults; no usable border-radius values found on the site'} */
  --radius-sm: ${radii.chosen.sm}px;
  --radius-md: ${radii.chosen.md}px;
  --radius-lg: ${radii.chosen.lg}px;

  /* Deck stage (letterbox behind the slide card) */
  --stage-bg: ${U(roles.stageBg)};
}
`;
}

/* ── Scorecard ────────────────────────────────────────────────────────────── */

function printScorecard(rows, js, name) {
  console.log(`\n── SITE READINESS SCORECARD ${'─'.repeat(38)}`);
  for (const r of rows) {
    const doc = r.status === 'ok' ? '' : `  → docs/website-requirements.md ("${r.doc}")`;
    console.log(`[${r.status}]`.padEnd(10) + r.label.padEnd(18) + r.detail + doc);
  }
  if (js.likely) {
    const markers = [
      js.rootShell && 'empty root <div>',
      js.hydrationMarkers && 'hydration markers',
      `${Math.round(js.scriptChars / 1024)} KB inline JS + ${js.externalScripts} external script(s)`,
    ].filter(Boolean);
    console.log(
      `\n[!] This page looks JS-rendered (${js.visibleTextChars} chars of visible text; ${markers.join(', ')}).` +
        `\n    extract.mjs reads server-sent HTML/CSS only, so every signal above is thin.` +
        `\n    → docs/website-requirements.md ("JS-rendered sites")`
    );
  } else if (js.thinContent) {
    console.log(
      `\n[i] Very little server-sent content (${js.visibleTextChars} chars of visible text), but no` +
        `\n    framework markers — the page is probably just small. Brand signals may still be thin.`
    );
  }
  console.log(`\nNext steps:`);
  console.log(`  1. open decks/${name}/index.html   — eyeball the skin on the starter slides`);
  console.log(`  2. resolve the TODO(spot-check) lines in decks/${name}/tokens.css`);
  console.log(`  3. node build.mjs ${name}   — single-file standalone HTML`);
}

/* ── Main pipeline ────────────────────────────────────────────────────────── */

const shortLabel = (u) => {
  const { hostname, pathname } = new URL(u);
  const s = hostname + pathname;
  return s.length > 72 ? s.slice(0, 69) + '...' : s;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const name = args.name || defaultDeckName(args.url);
  const warnings = [];

  // Fail on an existing deck *before* doing any network work.
  checkDeckWritable(name, args.force);

  // 1. Homepage ─────────────────────────────────────────────────────────────
  console.log(`fetching ${args.url}`);
  let page;
  try {
    page = await fetchText(args.url, { accept: 'text/html,application/xhtml+xml', truncate: true });
  } catch (err) {
    // Bare domains whose cert/DNS only covers www. are common — retry once.
    const u = new URL(args.url);
    if (u.hostname.startsWith('www.')) throw err;
    u.hostname = `www.${u.hostname}`;
    console.log(`  ${err.message}`);
    console.log(`  retrying as ${u.href}`);
    page = await fetchText(u.href, { accept: 'text/html,application/xhtml+xml', truncate: true });
  }
  const html = page.text;
  const base = page.finalUrl;
  if (!page.contentType.includes('html') && !/^\s*</.test(html))
    throw new Error(
      `${args.url} returned "${page.contentType || 'unknown content type'}", not HTML — point extract.mjs at the site's homepage`
    );
  if (base !== args.url) console.log(`  redirected to ${base}`);

  // Homepage is in hand — now it's safe to create the deck folder.
  const deckDir = scaffoldDeck(name, warnings);

  // 2. Stylesheets ──────────────────────────────────────────────────────────
  const sheets = [];
  let inlineIdx = 0;
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
    sheets.push({ label: `inline <style> #${++inlineIdx}`, url: null, css: m[1] });

  const sheetUrls = [];
  const seen = new Set();
  const queueSheet = (href) => {
    const resolved = safeResolve(decodeEntities(href), base);
    if (resolved && /^https?:/.test(resolved) && !seen.has(resolved)) {
      seen.add(resolved);
      sheetUrls.push(resolved);
    }
  };
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attrOf(m[0], 'rel').toLowerCase();
    const href = attrOf(m[0], 'href');
    if (!href) continue;
    // Google css2 links sometimes ride rel=preload rather than stylesheet.
    if (rel.includes('stylesheet') || /fonts\.googleapis\.com\/css/i.test(href)) queueSheet(href);
  }
  let failedSheets = 0;
  for (const url of sheetUrls.slice(0, MAX_SHEETS)) {
    try {
      const { text, truncated } = await fetchText(url, { accept: 'text/css,*/*;q=0.1', maxBytes: MAX_SHEET_BYTES, truncate: true });
      sheets.push({ label: shortLabel(url), url, css: text });
      if (truncated) warnings.push(`stylesheet truncated at ${MAX_SHEET_BYTES / 1024 / 1024}MB: ${url}`);
    } catch (err) {
      failedSheets++;
      warnings.push(`stylesheet failed: ${err.message}`);
    }
  }
  if (sheetUrls.length > MAX_SHEETS)
    warnings.push(`${sheetUrls.length - MAX_SHEETS} stylesheet(s) skipped beyond the ${MAX_SHEETS}-sheet cap`);

  // Google Fonts css2 URLs @import'ed inside sheets (or inline CSS).
  const googleUrls = new Set(sheetUrls.filter((u) => /fonts\.googleapis\.com\/css/i.test(u)));
  for (const s of sheets) {
    for (const m of s.css.matchAll(/https:\/\/fonts\.googleapis\.com\/css2?\?[^)"'\s]+/g)) {
      const u = decodeEntities(m[0]);
      if (googleUrls.has(u)) continue;
      googleUrls.add(u);
      try {
        const { text } = await fetchText(u, { accept: 'text/css,*/*;q=0.1', maxBytes: MAX_SHEET_BYTES, truncate: true });
        sheets.push({ label: shortLabel(u), url: u, css: text });
      } catch (err) {
        warnings.push(`google fonts css failed: ${err.message}`);
      }
    }
  }
  const cssBytes = sheets.reduce((n, s) => n + s.css.length, 0);
  console.log(
    `stylesheets: ${sheets.length} collected (${inlineIdx} inline, ${sheets.length - inlineIdx} fetched, ${failedSheets} failed) — ${Math.round(cssBytes / 1024)} KB CSS`
  );

  // 3a. Colors ──────────────────────────────────────────────────────────────
  const acc = { palette: new Map(), customProps: {}, btnPropRefs: new Set() };
  for (const s of sheets) scanCss(s.css, s.label, acc);
  creditButtonProps(acc);
  const themeColor = parseColor(metaContent(html, 'theme-color'));
  if (themeColor)
    addColor(acc.palette, themeColor.hex, '<meta name="theme-color">', { context: 'theme-color', weight: 2 });
  const roles = chooseRoles(acc.palette, warnings);
  console.log(
    `colors: ${acc.palette.size} distinct, primary ${roles.primary}` +
      (roles.fallbackPrimary ? ' (PLACEHOLDER)' : ` (${roles.primaryWhy})`)
  );

  // 3b. Fonts ───────────────────────────────────────────────────────────────
  const googleFamilies = new Map(); // lower name -> { family, weights, range }
  for (const u of googleUrls)
    for (const f of parseGoogleCss2Url(u))
      if (!googleFamilies.has(f.family.toLowerCase())) googleFamilies.set(f.family.toLowerCase(), f);
  const siteFaces = sheets.flatMap((s) => (s.url ? extractFontFaces(s.css, s.url) : extractFontFaces(s.css, base)));
  const knownReal = new Set([...googleFamilies.keys(), ...siteFaces.map((f) => f.family.toLowerCase())]);
  const fams = pickFamilies(extractFontStacks(sheets), knownReal, warnings);

  const fonts = { ...fams, downloaded: [], faceCss: [] };
  const toDownload = [...new Set([fams.display, fams.body].filter(Boolean))];
  for (const family of toDownload) {
    let faces = [];
    let via = null;
    if (googleFamilies.has(family.toLowerCase())) {
      via = 'google-fonts';
      faces = await resolveGoogleFaces(family);
    }
    if (!faces.length) {
      const own = siteFaces.filter((f) => f.family.toLowerCase() === family.toLowerCase() && f.latin);
      if (own.length) { via = 'site @font-face'; faces = own; }
    }
    if (!faces.length) {
      // The site names the family but hosts it opaquely (or not at all) —
      // if Google Fonts carries that exact name, it's almost certainly the
      // same face. Flagged so the user verifies the cut.
      faces = await resolveGoogleFaces(family);
      if (faces.length) {
        via = 'google-fonts by name (site does not load it from Google — verify the cut)';
        warnings.push(`font "${family}": no downloadable source on the site; fetched the same-named Google Fonts family instead`);
      }
    }
    if (!faces.length) {
      warnings.push(`font "${family}" identified but not downloadable (no Google Fonts or @font-face source)`);
      continue;
    }
    const files = await downloadFamily(deckDir, family, faces, warnings);
    if (files.length) {
      fonts.downloaded.push({ family, via, files });
      for (const f of files)
        fonts.faceCss.push(
          `@font-face { font-family: '${family}'; font-style: normal; font-weight: ${f.cssWeight}; font-display: swap; src: url('./fonts/${f.file}') format('${f.format}'); }` +
            (f.exact ? '' : ` /* nearest available cut: ${f.actualWeight} */`)
        );
      const nFiles = new Set(files.map((f) => f.file)).size;
      const nSlots = new Set(files.flatMap((f) => f.slots)).size;
      console.log(`fonts: ${family} — ${nFiles} file(s) covering ${nSlots} weight slot(s) via ${via}`);
    }
  }
  if (!fonts.downloaded.length)
    console.log(`fonts: none downloaded${fams.display ? ` (identified: ${[fams.display, fams.body].filter(Boolean).join(', ')})` : ''}`);

  // 3c. Logo ────────────────────────────────────────────────────────────────
  const logoCandidates = collectLogoCandidates(html, base);
  const logos = await downloadLogos(deckDir, logoCandidates, warnings);
  const bestLogo = logos.find((l) => l.bestGuess);
  console.log(
    `logo: ${logoCandidates.length} candidate(s), ${logos.length} downloaded` +
      (bestLogo ? ` — best guess ${bestLogo.bestGuess}` : '')
  );

  // 3d. Icon system + radii + meta ──────────────────────────────────────────
  const iconSystems = detectIconSystems(html, sheets);
  const radii = extractRadii(sheets);
  const ogSiteName = metaContent(html, 'og:site_name');
  const js = assessJsRendered(html, sheets);

  // 4. Write tokens.css + brand-report.json ─────────────────────────────────
  const date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(deckDir, 'tokens.css'), renderTokens({ name, site: base, date, roles, fonts, radii }));

  const report = {
    site: base,
    fetchedAt: new Date().toISOString(),
    deck: `decks/${name}/`,
    colors: {
      // capped at 80 — brand-ish names first so a framework's hundreds of
      // props can't crowd out the one that matters
      customProps: Object.fromEntries(
        Object.entries(acc.customProps)
          .sort(([a], [b]) => BRAND_PROP.test(b) - BRAND_PROP.test(a))
          .slice(0, 80)
      ),
      palette: [...acc.palette.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 40)
        .map((e) => ({ hex: e.hex, count: e.count, sheets: [...e.sheets], customProps: [...e.propNames], contexts: [...e.contexts] })),
      roles: {
        frameworkDefaultsExcluded: roles.frameworkExcluded,
        primary: { hex: roles.primary, sampled: roles.primarySampled, why: roles.primaryWhy },
        accent2: roles.accent2, accent3: roles.accent3, accent4: roles.accent4,
        text: { hex: roles.ink, why: roles.inkWhy },
        surface: { hex: roles.surface, why: roles.surfaceWhy },
        darkBg: { hex: roles.darkBg, why: roles.darkWhy },
        success: { hex: roles.success, why: roles.successWhy },
      },
    },
    fonts: {
      display: fonts.display, body: fonts.body, mono: fonts.mono,
      googleFamilies: [...googleFamilies.values()],
      siteFontFaces: siteFaces.map((f) => ({ family: f.family, weight: weightLabel(f.weight), src: f.src.url.slice(0, 200) })),
      downloaded: fonts.downloaded,
    },
    logoCandidates: logos.length ? logos : logoCandidates,
    ogSiteName: ogSiteName || null,
    iconSystem: iconSystems.length ? iconSystems : null,
    radii,
    jsRendered: js,
    warnings,
  };
  fs.writeFileSync(path.join(deckDir, 'brand-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`wrote decks/${name}/tokens.css and decks/${name}/brand-report.json`);
  for (const w of warnings) console.log(`  warning: ${w}`);

  // 5. Scorecard ────────────────────────────────────────────────────────────
  const externalOk = sheets.length - inlineIdx;
  const rows = [
    {
      label: 'stylesheets',
      status: externalOk > 0 && failedSheets === 0 ? 'ok' : externalOk > 0 || inlineIdx > 0 ? 'partial' : 'missing',
      detail: `${sheets.length} collected, ${failedSheets} failed (${Math.round(cssBytes / 1024)} KB CSS)`,
      doc: 'Stylesheets',
    },
    {
      label: 'brand colors',
      status: roles.fallbackPrimary ? 'missing' : roles.syntheticAccents ? 'partial' : 'ok',
      detail: roles.fallbackPrimary
        ? 'no saturated brand color found — placeholder primary written'
        : `primary ${roles.primary}${roles.syntheticAccents ? `, ${roles.syntheticAccents} accent(s) synthesized` : ' + 3 sampled accents'}`,
      doc: 'Colors',
    },
    (() => {
      const got = new Set(fonts.downloaded.map((d) => d.family));
      const undownloaded = [...new Set([fonts.display, fonts.body])].filter((f) => f && !got.has(f));
      return {
        label: 'fonts',
        status: fonts.downloaded.length
          ? undownloaded.length ? 'partial' : 'ok'
          : fonts.display || fonts.body ? 'partial' : 'missing',
        detail: fonts.downloaded.length
          ? fonts.downloaded
              .map((d) => {
                const n = new Set(d.files.flatMap((f) => f.slots)).size;
                const variable = d.files.some((f) => f.cssWeight.includes(' '));
                return `${d.family} (${n} weights${variable ? ', variable' : ''})`;
              })
              .join(', ') + (undownloaded.length ? `; ${undownloaded.join(', ')} not downloadable` : '')
          : fonts.display || fonts.body
            ? `identified (${[fonts.display, fonts.body].filter(Boolean).join(', ')}) but not downloadable`
            : 'no brand font identified',
        doc: 'Fonts',
      };
    })(),
    {
      label: 'logo',
      status: bestLogo ? 'ok' : logoCandidates.length ? 'partial' : 'missing',
      detail: bestLogo
        ? `${logos.length} candidate(s) in assets/, best guess ${bestLogo.bestGuess} (dims: ${bestLogo.dimensions})`
        : logoCandidates.length
          ? `${logoCandidates.length} candidate(s) found but none downloaded`
          : 'no logo-looking image found',
      doc: 'Logo',
    },
    {
      label: 'icon system',
      status: iconSystems.length ? 'ok' : 'missing',
      detail: iconSystems.length
        ? iconSystems.map((i) => `${i.name} (${i.evidence})`).join(', ') + ' — self-host it for the deck, do not hotlink'
        : 'none detected — pick one manually for the deck',
      doc: 'Icons',
    },
    {
      label: 'theme/og tags',
      status: themeColor && ogSiteName ? 'ok' : themeColor || ogSiteName ? 'partial' : 'missing',
      detail: [
        themeColor ? `theme-color ${themeColor.hex}` : 'no theme-color',
        ogSiteName ? `og:site_name "${ogSiteName}"` : 'no og:site_name',
      ].join(', '),
      doc: 'Meta',
    },
  ];
  printScorecard(rows, js, name);
}

/* Exported for smoke tests (node -e "import('./extract.mjs').then(...)");
   main() only runs when the file is invoked directly. */
export {
  parseColor, rgbToHsl, hslToRgb, mixHex, darken, lighten, hueDist, chooseRoles,
  scanCss, creditButtonProps, parseGoogleCss2Url, extractFontFaces, assignSlots,
  extractFontStacks, pickFamilies, extractRadii, collectLogoCandidates,
  detectIconSystems, assessJsRendered, defaultDeckName, renderTokens,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // Bare usage errors read better without the failure prefix.
    console.error(err.message.startsWith('Usage:') ? err.message : `\nextract failed: ${err.message}`);
    process.exit(1);
  });
}
