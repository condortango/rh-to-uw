// build.mjs
// Turns rh-to-uw.mjs into a javascript: URL and writes rh-to-uw.bookmarklet.txt.
//
//   node src/rh-to-uw/build.mjs
//
// The module is kept readable; this script does the squeezing: comment lines,
// blank lines, indentation, the export keywords and the auto-run guard go,
// spaces next to punctuation go (outside string literals), and the rest is
// wrapped in an IIFE and percent-encoded so # and % survive bookmark managers.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MODULE_PATH = join(HERE, 'rh-to-uw.mjs');
export const OUTPUT_PATH = join(HERE, 'rh-to-uw.bookmarklet.txt');
// Served by GitHub Pages from the main branch's /docs folder, so the drag link
// can be reached at https://<user>.github.io/<repo>/ as well as from a checkout.
export const INSTALL_PATH = join(HERE, '..', '..', 'docs', 'index.html');
export const MAX_BYTES = 32768;

const STRIP_BLOCK_RE = /^[ \t]*\/\/ @bookmarklet-strip-start[\s\S]*?\/\/ @bookmarklet-strip-end[ \t]*$/gm;
const EXPORT_RE = /^export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/;
const PUNCT = new Set('{}()[];,=:<>!&|?*'.split(''));
const QUOTES = new Set(['\'', '"', '`']);
// A squeezed line is glued to the previous one when that one ends with one of
// these; any other line break is kept so ASI can never be surprised.
const GLUE_AFTER = new Set(['{', '}', ';', ',']);
// A line starting with one of these could change meaning when glued.
const UNSAFE_LINE_START = /^[([+\-\/`]/;

// Drops spaces and tabs that sit next to punctuation, leaving string literals
// untouched. The module has no regex literal containing a quote character, so
// tracking quotes is enough.
export function squeezeLine(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        i += 1;
        out += i < line.length ? line[i] : '';
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (QUOTES.has(ch)) {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      let j = i + 1;
      while (j < line.length && (line[j] === ' ' || line[j] === '\t')) {
        j += 1;
      }
      const prev = out[out.length - 1];
      const next = line[j];
      if (prev === undefined || next === undefined || PUNCT.has(prev) || PUNCT.has(next)) {
        i = j - 1;
        continue;
      }
      out += ' ';
      i = j - 1;
      continue;
    }
    out += ch;
  }
  if (quote) {
    throw new Error('unterminated string literal while squeezing: ' + line);
  }
  return out;
}

// Module source -> plain-script body (no exports, no guard, squeezed).
export function stripModule(moduleSource) {
  const lines = [];
  for (const raw of moduleSource.replace(STRIP_BLOCK_RE, '').split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//')) {
      continue;
    }
    if (UNSAFE_LINE_START.test(line)) {
      throw new Error('a line may not start with ( [ + - / or a backtick: ' + line);
    }
    lines.push(squeezeLine(line.replace(EXPORT_RE, '')));
  }
  let out = '';
  for (const line of lines) {
    out += out === '' || GLUE_AFTER.has(out[out.length - 1]) ? line : '\n' + line;
  }
  return out;
}

export function buildBookmarklet(moduleSource) {
  if (/^\s*import\b/m.test(moduleSource)) {
    throw new Error('the module must not import anything; the bookmarklet has to be fully inline');
  }
  const body = '(()=>{' + stripModule(moduleSource) + '\nmain();})();';
  const url = 'javascript:' + encodeURIComponent(body);
  const bytes = Buffer.byteLength(url);
  if (bytes >= MAX_BYTES) {
    throw new Error('bookmarklet is ' + bytes + ' bytes; it must stay under ' + MAX_BYTES);
  }
  return url;
}

export function decodeBookmarklet(url) {
  if (!url.startsWith('javascript:')) {
    throw new Error('not a javascript: URL');
  }
  return decodeURIComponent(url.slice('javascript:'.length));
}

// A page whose one link carries the built bookmarklet, so it can be dragged
// onto the bookmarks bar. Markdown hosts strip javascript: links, which is
// why this lives in its own file. encodeURIComponent never emits < > " or &,
// so the href is safe inside double quotes; the check below keeps it so.
export function buildInstallPage(url) {
  if (!url.startsWith('javascript:') || /[<>"&]/.test(url)) {
    throw new Error('expected a percent-encoded javascript: URL');
  }
  return [
    '<!doctype html>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>rh-to-uw</title>',
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40em;margin:3em auto;padding:0 1em;color:#111;background:#fff}'
      + 'a.bm{display:inline-block;padding:.5em 1em;border:2px solid #52A3CF;border-radius:6px;color:inherit;text-decoration:none;font-weight:700}'
      + 'textarea{width:100%;height:6em;font:12px/1.4 monospace}ol{padding-left:1.4em}</style>',
    '<h1>rh-to-uw</h1>',
    '<p>Jump from an option in Robinhood to its Unusual Whales contract page.</p>',
    '<h2>Install</h2>',
    '<p>Drag this link onto your bookmarks bar:</p>',
    '<p><a class="bm" href="' + url + '">RH to UW</a></p>',
    '<p>Or add a bookmark by hand and paste this as its URL (click the box, select all, copy):</p>',
    '<textarea readonly>' + url + '</textarea>',
    '<h2>Use</h2>',
    '<ol><li>Click the bookmarklet.</li><li>Click any option in your Robinhood portfolio.</li><li>Unusual Whales opens in a new tab, already on that contract.</li></ol>',
    '<p>Works in Robinhood Classic and Legend. Esc cancels. The whole program is the link above; it talks to nothing except the Unusual Whales page it opens.</p>',
    '<p><a href="https://github.com/condortango/rh-to-uw/blob/main/src/rh-to-uw/rh-to-uw.mjs">Readable source</a></p>',
    '<p><a href="https://github.com/condortango/rh-to-uw">Project on GitHub</a></p>',
    '',
  ].join('\n');
}

function isCli() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCli()) {
  const url = buildBookmarklet(readFileSync(MODULE_PATH, 'utf8'));
  // Parse only: proves the squeezed body is still valid script.
  new Function(decodeBookmarklet(url));
  writeFileSync(OUTPUT_PATH, url + '\n');
  mkdirSync(dirname(INSTALL_PATH), { recursive: true });
  writeFileSync(INSTALL_PATH, buildInstallPage(url));
  // Keeps Jekyll from processing the folder on GitHub Pages.
  writeFileSync(join(dirname(INSTALL_PATH), '.nojekyll'), '');
  console.log('wrote ' + OUTPUT_PATH + ' (' + Buffer.byteLength(url) + ' bytes)');
  console.log('wrote ' + INSTALL_PATH);
}
