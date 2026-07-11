#!/usr/bin/env node
/* Build a share-ready standalone HTML for one or all decks.
   Inlines linked CSS (with fonts/images inside url() rewritten to data URIs),
   scripts, <img> sources, and the favicon, so the output file has zero
   external references and can be sent as a single attachment.

   Usage:  node build.mjs [deck-name ...] [--public]
           (no names = every decks/<name>/ containing an index.html)
   Output: decks/<name>/<name>-standalone.html
           with --public, also drops every slide <section> carrying the
           data-internal attribute (any attribute order) and emits
           decks/<name>/<name>-public.html                                     */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = path.dirname(fileURLToPath(import.meta.url));
const decksDir = path.join(repoDir, 'decks');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

// Strip ?query and #fragment (e.g. bootstrap-icons.woff2?abc) before resolving.
const cleanRef = (ref) => ref.replace(/[?#].*$/, '');

function toDataUri(file) {
  const clean = cleanRef(file);
  const mime = MIME[path.extname(clean).toLowerCase()];
  if (!mime) throw new Error(`No MIME mapping for ${clean}`);
  return `data:${mime};base64,${fs.readFileSync(clean).toString('base64')}`;
}

// Rewrite every url(...) in a CSS string to a data URI, relative to baseDir.
function inlineCssUrls(css, baseDir) {
  return css.replace(/url\((['"]?)([^)'"]+)\1\)/g, (m, _q, ref) => {
    if (ref.startsWith('data:') || ref.startsWith('#') || /^https?:/.test(ref)) return m;
    return `url('${toDataUri(path.resolve(baseDir, cleanRef(ref)))}')`;
  });
}

function buildDeck(name, isPublic) {
  const deckDir = path.join(decksDir, name);
  const src = path.join(deckDir, 'index.html');
  let html = fs.readFileSync(src, 'utf8');

  // --public: drop internal-only slides. The nav JS derives the slide total
  // from the DOM at load, so the counter self-corrects — no renumbering needed.
  // Attribute-order-agnostic: any <section> whose open tag carries BOTH a
  // class containing `slide` (bare `slide`, `slide has-grid`, …) and the
  // data-internal attribute is removed — whole block, non-greedy to the first
  // </section>, with surrounding whitespace — regardless of attribute order.
  if (isPublic) {
    html = html.replace(/[ \t]*<section\b([^>]*)>[\s\S]*?<\/section>\n?/g, (m, attrs) =>
      /\bdata-internal\b/.test(attrs) && /\bclass\s*=\s*"[^"]*\bslide\b[^"]*"/.test(attrs) ? '' : m
    );
    // Belt and braces: if any data-internal section survived (odd quoting,
    // missing class, nesting), fail loudly rather than leak it.
    if (/<section[^>]*\bdata-internal/.test(html)) {
      throw new Error(`${name}: a data-internal <section> survived the --public strip — refusing to write a leaking public build`);
    }
  }

  // <link rel="stylesheet"> → <style> with url() assets inlined.
  // Attribute-order/shape tolerant: any <link> whose attrs include
  // rel="stylesheet" is inlined, pulling href (and an optional media attr,
  // which is preserved on the <style>) wherever they sit in the tag.
  html = html.replace(/<link\b[^>]*>/g, (m) => {
    if (!/\brel\s*=\s*"stylesheet"/.test(m)) return m;
    const href = (m.match(/\bhref\s*=\s*"([^"]+)"/) || [])[1];
    if (!href || /^(?:data:|https?:)/.test(href)) return m;
    const media = (m.match(/\bmedia\s*=\s*"([^"]+)"/) || [])[1];
    const cssFile = path.resolve(deckDir, href);
    const css = inlineCssUrls(fs.readFileSync(cssFile, 'utf8'), path.dirname(cssFile));
    return `<style${media ? ` media="${media}"` : ''}>\n${css}\n</style>`;
  });

  // <script src> → inline script. Tolerates extra attrs (defer, type, …) in
  // any order; a type attr is preserved, defer is dropped (meaningless on an
  // inline script — end-of-body order already gives the same timing).
  html = html.replace(/<script\b([^>]*)>\s*<\/script>/g, (m, attrs) => {
    const srcRef = (attrs.match(/\bsrc\s*=\s*"([^"]+)"/) || [])[1];
    if (!srcRef || /^(?:data:|https?:)/.test(srcRef)) return m;
    const type = (attrs.match(/\btype\s*=\s*"([^"]+)"/) || [])[1];
    return `<script${type ? ` type="${type}"` : ''}>\n${fs.readFileSync(path.resolve(deckDir, srcRef), 'utf8')}\n</script>`;
  });

  // Mask <script>...</script> bodies so the src/href passes below don't rewrite
  // HTML-looking strings that live *inside* inlined JS (e.g. an SVG renderer's
  // `<img src="'+s+'">` template literals). A placeholder stands in for each
  // block, restored after the attribute passes complete.
  const scripts = [];
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (m) => {
    scripts.push(m);
    return `\u0000SCRIPT${scripts.length - 1}\u0000`;
  });

  // <img src> and favicon href → data URIs
  html = html.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/g, (m, pre, ref, post) =>
    ref.startsWith('data:') ? m : pre + toDataUri(path.resolve(deckDir, ref)) + post
  );
  html = html.replace(/(<link\s+rel="icon"[^>]*\bhref=")([^"]+)(")/g, (m, pre, ref, post) =>
    ref.startsWith('data:') ? m : pre + toDataUri(path.resolve(deckDir, ref)) + post
  );

  // Restore the inlined script blocks.
  html = html.replace(/\u0000SCRIPT(\d+)\u0000/g, (_m, i) => scripts[+i]);

  const rebuildCmd = `node build.mjs ${name}${isPublic ? ' --public' : ''}`;
  html = html.replace(
    '<!doctype html>',
    `<!doctype html>\n<!-- GENERATED FILE — do not edit by hand.\n     Source: decks/${name}/index.html\n     Rebuild: ${rebuildCmd} -->`
  );

  // Leftover check. Any src/href whose value is not data:, a #hash, http(s),
  // mailto: or tel: is an unresolved reference — bare relative refs like
  // href="tokens.css" fail the build instead of shipping broken. Script
  // BODIES are re-masked for this pass (opening tags kept, so an un-inlined
  // <script src> is still caught) because inlined JS may legitimately build
  // src="/href=" strings. The url() check keeps its existing shape.
  const checkHtml = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/g, '$1</script>');
  const leftovers = [
    ...checkHtml.matchAll(/(?:src|href)="(?!data:|#|https?:\/\/|mailto:|tel:)[^"]*"/g),
    ...html.matchAll(/url\((['"]?)(?!\1(?:data:|#))[^)]*\)/g),
  ].filter((m) => !m[0].includes('data:'));
  if (leftovers.length) throw new Error(`${name}: unresolved relative references remain: ${leftovers[0][0]}`);

  const out = path.join(deckDir, `${name}-${isPublic ? 'public' : 'standalone'}.html`);
  fs.writeFileSync(out, html);
  console.log(`${path.relative(process.cwd(), out)}  (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}

const argv = process.argv.slice(2);
const isPublic = argv.includes('--public');
const requested = argv.filter((a) => !a.startsWith('--'));
const names = requested.length
  ? requested
  : fs
      .readdirSync(decksDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(decksDir, d.name, 'index.html')))
      .map((d) => d.name);

if (!names.length) {
  console.error('No decks found.');
  process.exit(1);
}
names.forEach((n) => buildDeck(n, isPublic));
