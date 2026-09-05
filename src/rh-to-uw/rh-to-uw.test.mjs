// rh-to-uw.test.mjs
//   node --test src/rh-to-uw/rh-to-uw.test.mjs
//   node --test --test-name-pattern "parse-row" src/rh-to-uw/rh-to-uw.test.mjs
// Node 20+, no dependencies.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseRobinhoodOption,
  toOsiSymbol,
  buildUnusualWhalesUrl,
  inferYear,
  countContracts,
  findRow,
  findContract,
  highlightRect,
  armPicker,
  BANNER_TEXT,
  NO_CONTRACT_TEXT,
  UW_BLUE,
  HIGHLIGHT_WIDTH,
  UW_BASE,
} from './rh-to-uw.mjs';
import {
  buildBookmarklet,
  decodeBookmarklet,
  stripModule,
  squeezeLine,
  MODULE_PATH,
  OUTPUT_PATH,
  MAX_BYTES,
  INSTALL_PATH,
  buildInstallPage,
} from './build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TODAY = '2026-09-04';
const LEGEND_TODAY = '2026-09-05';
const CHAIN_TODAY = '2026-09-05';
const ACME_URL = 'https://unusualwhales.com/flow/option_chains?chain=ACME261218C00050000&days=1&mins=5';
const ZORK_URL = 'https://unusualwhales.com/flow/option_chains?chain=ZORK261016C00075000&days=1&mins=5';
const ROW_TEXT = 'ACME $50 Call\n12/18 • 5 Buys\n-$250.00\n-25.00%';
const LEGEND_TEXT = 'ZORK 10/16 $75 Call\n12.34%\n3\n$1.23\n$1,234.00\n$123.00\n4.56%\n41D';
const CHAIN_ROW_TEXT = '$50\n$50.18\n+0.36%\n-12.34%\n-$0.10\n$0.18';
const ACME = { ticker: 'ACME', strike: 50, type: 'call', expiry: '2026-12-18' };
const ZORK = { ticker: 'ZORK', strike: 75, type: 'call', expiry: '2026-10-16' };

// Every way a script could reach an endpoint, load a resource, run remote
// code or persist data, checked as plain substrings of the comment-stripped
// module and of the decoded bookmarklet by the no-network tests. README.md's
// Privacy section points here. Shortening this list is a planning decision,
// not a fix.
export const FORBIDDEN_TOKENS = [
  'fetch', 'XMLHttpRequest', 'XDomainRequest', 'WebSocket', 'EventSource', 'sendBeacon',
  'Image', 'importScripts', 'import(', 'require(', '<script', 'iframe',
  "createElement('script", "createElement('img", "createElement('link", '.src',
  'Worker', 'SharedWorker', 'serviceWorker', 'RTCPeerConnection', 'postMessage',
  'document.cookie', 'localStorage', 'sessionStorage', 'indexedDB', 'caches',
  'eval(', 'Function(', 'document.write', 'navigator.', '@import', 'url(',
];
// "<scheme>://..." up to whitespace, a quote or a closing paren.
const SCHEME_URL_RE = /[a-z][a-z0-9+.-]*:\/\/[^\s'"`)]+/g;
// Anything shaped like a hostname on a common TLD. The lookahead keeps a
// property access such as row.contract from reading as ".co".
const HOSTNAME_RE = /[A-Za-z0-9.-]+\.(?:com|net|io|org|co)(?![A-Za-z0-9_])/g;

// innerText of a fixture, derived without a DOM: block boundaries (div,
// heading, section, table and button tags) become line breaks, every other
// tag is dropped.
function fixtureText(name) {
  const html = readFileSync(join(HERE, 'fixtures', name), 'utf8');
  return html
    .replace(/<\/?(?:div|h[1-6]|section|header|p|table|tbody|tr|td|button)\b[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

test('osi-symbol', () => {
  assert.equal(
    toOsiSymbol({ ticker: 'ACME', expiry: '2026-12-18', strike: 50, type: 'call' }),
    'ACME261218C00050000',
  );
  const brk = toOsiSymbol({ ticker: 'BRK.B', expiry: '2026-12-18', strike: 2.5, type: 'put' });
  assert.ok(brk.startsWith('BRKB'), brk);
  assert.ok(brk.endsWith('P00002500'), brk);
  assert.equal(brk, 'BRKB261218P00002500');
  assert.equal(toOsiSymbol({ ticker: 'spy', expiry: '2026-09-18', strike: 132.5, type: 'CALL' }), 'SPY260918C00132500');
  assert.equal(toOsiSymbol({ ticker: 'TSLA', expiry: new Date(2027, 0, 15), strike: 1000, type: 'put' }), 'TSLA270115P01000000');
  assert.equal(toOsiSymbol({ ticker: 'F', expiry: '2026-12-18', strike: 0.5, type: 'call' }), 'F261218C00000500');
  assert.throws(() => toOsiSymbol({ ticker: 'ACME', expiry: '2026-12-18', strike: 50, type: 'straddle' }));
  assert.throws(() => toOsiSymbol({ ticker: 'ACME', expiry: 'someday', strike: 50, type: 'call' }));
  assert.throws(() => toOsiSymbol({ ticker: 'ACME', expiry: '2026-12-18', strike: 0, type: 'call' }));
  assert.throws(() => toOsiSymbol(null));
});

test('target-url', () => {
  assert.equal(buildUnusualWhalesUrl('ACME261218C00050000'), ACME_URL);
  assert.equal(
    buildUnusualWhalesUrl('BRKB261218P00002500'),
    'https://unusualwhales.com/flow/option_chains?chain=BRKB261218P00002500&days=1&mins=5',
  );
  assert.throws(() => buildUnusualWhalesUrl('not an osi'));
  assert.throws(() => buildUnusualWhalesUrl('acme261218c00050000'));
  assert.throws(() => buildUnusualWhalesUrl(42));
});

test('parse-row', () => {
  const text = fixtureText('rh-row-classic.html');
  assert.equal(text, ROW_TEXT);
  const acme = { ticker: 'ACME', strike: 50, type: 'call', expiry: '2026-12-18' };
  assert.deepEqual(parseRobinhoodOption(text, TODAY), acme);
  assert.equal(buildUnusualWhalesUrl(toOsiSymbol(parseRobinhoodOption(text, TODAY))), ACME_URL);

  // stock rows and other non-option text
  assert.equal(parseRobinhoodOption('AAPL 10 shares $1,234.56', TODAY), null);
  assert.equal(parseRobinhoodOption('AAPL\n10 shares\n$1,234.56\n+1.20%', TODAY), null);
  assert.equal(parseRobinhoodOption('Options\nBuying power $5,000.00', TODAY), null);
  assert.equal(parseRobinhoodOption('', TODAY), null);
  assert.equal(parseRobinhoodOption(undefined, TODAY), null);
  assert.equal(parseRobinhoodOption(null, TODAY), null);

  // strike forms
  assert.deepEqual(parseRobinhoodOption('SPY $2.50 Put\n9/18 • 3 Sells', TODAY), { ticker: 'SPY', strike: 2.5, type: 'put', expiry: '2026-09-18' });
  assert.deepEqual(parseRobinhoodOption('SPY $132.5 Call\n9/18 • 1 Buy', TODAY), { ticker: 'SPY', strike: 132.5, type: 'call', expiry: '2026-09-18' });
  assert.deepEqual(parseRobinhoodOption('TSLA $1,000 Call\n1/15 • 1 Buy', TODAY), { ticker: 'TSLA', strike: 1000, type: 'call', expiry: '2027-01-15' });
  assert.deepEqual(parseRobinhoodOption('NVDA 150 Call\n10/16 • 2 Buys', TODAY), { ticker: 'NVDA', strike: 150, type: 'call', expiry: '2026-10-16' });

  // ticker with a dot, type in any letter case
  assert.deepEqual(parseRobinhoodOption('BRK.B $470 put\n10/16 • 2 Buys', TODAY), { ticker: 'BRK.B', strike: 470, type: 'put', expiry: '2026-10-16' });
  assert.deepEqual(parseRobinhoodOption('BRK.B $470 PUT\n10/16 • 2 Buys', TODAY), { ticker: 'BRK.B', strike: 470, type: 'put', expiry: '2026-10-16' });

  // explicit years
  assert.deepEqual(parseRobinhoodOption('ACME $50 Call\n12/18/26 • 5 Buys', TODAY), acme);
  assert.deepEqual(parseRobinhoodOption('ACME $50 Call\n12/18/2026 • 5 Buys', TODAY), acme);

  // the number directly before the type is the strike; other amounts never are
  assert.equal(parseRobinhoodOption('ACME $50 Call\n12/18 • 5 Buys\n-$250.00', TODAY).strike, 50);

  // multi-leg rows: the first pair wins (documented limitation)
  assert.deepEqual(parseRobinhoodOption('SPY $650 Call / $660 Call\n9/18 • 1 Buy', TODAY), { ticker: 'SPY', strike: 650, type: 'call', expiry: '2026-09-18' });

  // rejected shapes
  assert.equal(parseRobinhoodOption('ACME $50 C\n12/18 • 5 Buys', TODAY), null);
  assert.equal(parseRobinhoodOption('ACME $50 Calls\n12/18 • 5 Buys', TODAY), null);
  assert.equal(parseRobinhoodOption('ACME $50 Call', TODAY), null);
  assert.equal(parseRobinhoodOption('acme $50 Call\n12/18', TODAY), null);
  assert.equal(parseRobinhoodOption('ABCDEFG $50 Call\n12/18', TODAY), null);
});

test('year-inference', () => {
  assert.equal(inferYear(1, 17, TODAY), 2027);
  assert.equal(inferYear(9, 11, TODAY), 2026);
  assert.equal(inferYear(9, 4, TODAY), 2026);
  assert.equal(inferYear(9, 3, TODAY), 2027);
  assert.equal(inferYear(12, 31, TODAY), 2026);
  assert.equal(inferYear(1, 17, new Date(2026, 8, 4)), 2027);

  const row = (expiry) => parseRobinhoodOption('AAPL $200 Call\n' + expiry + ' • 1 Buy', TODAY);
  assert.equal(row('1/17').expiry, '2027-01-17');
  assert.equal(row('12/18').expiry, '2026-12-18');
  assert.equal(row('9/4').expiry, '2026-09-04');
  assert.equal(row('9/3').expiry, '2027-09-03');
  assert.equal(row('12/31').expiry, '2026-12-31');
  assert.equal(row('2/29'), null);
  assert.equal(row('2/30'), null);
  assert.equal(row('13/1'), null);
  assert.equal(row('0/5'), null);
  assert.equal(parseRobinhoodOption('AAPL $200 Call\n1/17 • 1 Buy', new Date(2026, 8, 4)).expiry, '2027-01-17');
  assert.equal(parseRobinhoodOption('AAPL $200 Call\n1/17 • 1 Buy', new Date(2026, 0, 17)).expiry, '2026-01-17');
});

test('legend-parse', () => {
  // the Legend fixture reads "<TICKER> <M/D> $<strike> Call", expiry first
  const text = fixtureText('rh-legend-row.html');
  assert.equal(text, LEGEND_TEXT);
  assert.deepEqual(parseRobinhoodOption(text, LEGEND_TODAY), ZORK);
  assert.equal(toOsiSymbol(parseRobinhoodOption(text, LEGEND_TODAY)), 'ZORK261016C00075000');
  assert.equal(buildUnusualWhalesUrl(toOsiSymbol(parseRobinhoodOption(text, LEGEND_TODAY))), ZORK_URL);

  // the row text decides which UI it is: the Classic fixture reads as before
  assert.deepEqual(parseRobinhoodOption(fixtureText('rh-row-classic.html'), TODAY), ACME);
  assert.deepEqual(parseRobinhoodOption(ROW_TEXT, TODAY), ACME);

  // the Legend head on its own, without the value cells
  assert.deepEqual(parseRobinhoodOption('ZORK 10/16 $75 Call', LEGEND_TODAY), ZORK);

  // explicit years in the Legend position
  assert.deepEqual(parseRobinhoodOption('ZORK 10/16/26 $75 Call', LEGEND_TODAY), ZORK);
  assert.deepEqual(parseRobinhoodOption('ZORK 10/16/2026 $75 Call', LEGEND_TODAY), ZORK);

  // strike forms and type case in the Legend position
  assert.deepEqual(parseRobinhoodOption('SPY 12/18 $2.50 put\n104D', LEGEND_TODAY), { ticker: 'SPY', strike: 2.5, type: 'put', expiry: '2026-12-18' });
  assert.deepEqual(parseRobinhoodOption('TSLA 1/15 $1,000 Call', LEGEND_TODAY), { ticker: 'TSLA', strike: 1000, type: 'call', expiry: '2027-01-15' });
  assert.deepEqual(parseRobinhoodOption('BRK.B 10/16 470 PUT', LEGEND_TODAY), { ticker: 'BRK.B', strike: 470, type: 'put', expiry: '2026-10-16' });

  // a days-to-expiration token is not an expiry
  assert.equal(parseRobinhoodOption('ZORK $75 Call\n41D', LEGEND_TODAY), null);

  // counting contract heads
  assert.equal(countContracts(LEGEND_TEXT), 1);
  assert.equal(countContracts(ROW_TEXT), 1);
  assert.equal(countContracts(LEGEND_TEXT + '\nSPY 12/18 $650 Put\n104D'), 2);
  assert.equal(countContracts('Options\n' + ROW_TEXT + '\nSPY $650 Call\n9/18 • 1 Buy'), 2);
  assert.equal(countContracts('AAPL\n10 shares\n$1,234.56'), 0);
  assert.equal(countContracts(''), 0);
  assert.equal(countContracts(null), 0);
});

test('dte-year', () => {
  // the token picks the candidate year whose expiry is that many days away
  assert.equal(parseRobinhoodOption('XYZ 1/15 $100 Call\n497D', LEGEND_TODAY).expiry, '2028-01-15');
  // without a token the plain inference stands
  assert.equal(parseRobinhoodOption('XYZ 1/15 $100 Call', LEGEND_TODAY).expiry, '2027-01-15');
  // an explicit year wins over the token
  assert.equal(parseRobinhoodOption('XYZ 1/15/27 $100 Call\n497D', LEGEND_TODAY).expiry, '2027-01-15');
  assert.equal(parseRobinhoodOption('XYZ 1/15/2027 $100 Call\n497D', LEGEND_TODAY).expiry, '2027-01-15');

  // the token agrees with the inferred year: result unchanged
  assert.equal(parseRobinhoodOption('ZORK 10/16 $75 Call\n41D', LEGEND_TODAY).expiry, '2026-10-16');
  assert.equal(parseRobinhoodOption(LEGEND_TEXT, LEGEND_TODAY).expiry, '2026-10-16');

  // the year before: a 0D token two days into January means the year that just ended
  assert.equal(parseRobinhoodOption('XYZ 12/31 $100 Call\n0D', '2026-01-02').expiry, '2025-12-31');

  // a token that fits none of the three candidate years is ignored
  assert.equal(parseRobinhoodOption('XYZ 1/15 $100 Call\n1000D', LEGEND_TODAY).expiry, '2027-01-15');
  assert.equal(parseRobinhoodOption('XYZ 1/15 $100 Call\n5D', LEGEND_TODAY).expiry, '2027-01-15');

  // Feb 29 becomes reachable when the token points at the leap year
  assert.equal(parseRobinhoodOption('XYZ 2/29 $100 Call\n542D', LEGEND_TODAY).expiry, '2028-02-29');
  assert.equal(parseRobinhoodOption('XYZ 2/29 $100 Call', LEGEND_TODAY), null);

  // the option chain writes the token in parentheses after the expiry,
  // with a lowercase d; both forms read alike
  assert.equal(parseRobinhoodOption('XYZ 1/15 $100 Call\n(497d)', LEGEND_TODAY).expiry, '2028-01-15');
  assert.equal(parseRobinhoodOption('XYZ $100 Call\nJan 15 (497d)', LEGEND_TODAY).expiry, '2028-01-15');
  assert.equal(parseRobinhoodOption('XYZ $100 Call\nJan 15 (497D)', LEGEND_TODAY).expiry, '2028-01-15');
  assert.equal(parseRobinhoodOption('XYZ $100 Call\nJanuary 15 (497d)', LEGEND_TODAY).expiry, parseRobinhoodOption('XYZ 1/15 $100 Call\n497D', LEGEND_TODAY).expiry);
  assert.equal(parseRobinhoodOption('ZORK 10/16 $75 Call\n(41d)', LEGEND_TODAY).expiry, '2026-10-16');
  assert.equal(parseRobinhoodOption('XYZ $100 Call\nDecember 18 (104d)', LEGEND_TODAY).expiry, '2026-12-18');
  assert.equal(parseRobinhoodOption('XYZ $100 Call\nDec 18 (0d)', LEGEND_TODAY).expiry, '2026-12-18');
  // a lowercase d needs the parentheses; a bare "497d" is no token
  assert.equal(parseRobinhoodOption('XYZ 1/15 $100 Call\n497d', LEGEND_TODAY).expiry, '2027-01-15');
  assert.equal(parseRobinhoodOption('XYZ 1/15 $100 Call\n497d)', LEGEND_TODAY).expiry, '2027-01-15');

  // Classic rows carry no token and are unaffected either way
  assert.equal(parseRobinhoodOption('XYZ $100 Call\n1/15 • 1 Buy', LEGEND_TODAY).expiry, '2027-01-15');
  assert.equal(parseRobinhoodOption('XYZ $100 Call\n1/15 • 1 Buy\n497D', LEGEND_TODAY).expiry, '2028-01-15');
});

test('expiry-words', () => {
  // month names after the type: with or without a year, with an Exp prefix,
  // abbreviated with or without a period, in any letter case
  assert.deepEqual(parseRobinhoodOption('ACME $50 Call\nExpires Dec 18', TODAY), ACME);
  assert.deepEqual(parseRobinhoodOption('ACME $50 Call\nDecember 18, 2026', TODAY), ACME);
  assert.deepEqual(parseRobinhoodOption('ACME $50 Call\nDec 18 2026 • 5 Buys', TODAY), ACME);
  assert.deepEqual(parseRobinhoodOption('ACME $50 Call\nExpiration Dec 18, 2026', TODAY), ACME);
  assert.deepEqual(parseRobinhoodOption('ACME $50 Call\nExp. Dec. 18', TODAY), ACME);
  assert.deepEqual(parseRobinhoodOption('ACME $50 Call\ndec 18', TODAY), ACME);
  assert.deepEqual(parseRobinhoodOption('ACME $50 Call Dec 18', TODAY), ACME);
  assert.deepEqual(parseRobinhoodOption('ACME $50 Call\nSept. 18', TODAY), { ticker: 'ACME', strike: 50, type: 'call', expiry: '2026-09-18' });
  assert.equal(parseRobinhoodOption('ACME $50 Call\nSep 18', TODAY).expiry, '2026-09-18');
  assert.equal(parseRobinhoodOption('ACME $50 Call\nSeptember 18', TODAY).expiry, '2026-09-18');
  assert.equal(parseRobinhoodOption('SPY $2.50 Put\nMar 20', TODAY).expiry, '2027-03-20');

  // no year: the next time that date comes around, as with 12/18
  assert.equal(parseRobinhoodOption('AAPL $200 Call\nJan 17 • 1 Buy', TODAY).expiry, '2027-01-17');
  assert.equal(parseRobinhoodOption('AAPL $200 Call\nSep 4', TODAY).expiry, '2026-09-04');
  assert.equal(parseRobinhoodOption('AAPL $200 Call\nSep 3', TODAY).expiry, '2027-09-03');

  // a written year wins; a days-to-expiration token corrects an inferred one
  assert.equal(parseRobinhoodOption('XYZ $100 Call\nJan 15, 2027\n497D', LEGEND_TODAY).expiry, '2027-01-15');
  assert.equal(parseRobinhoodOption('XYZ $100 Call\nJan 15\n497D', LEGEND_TODAY).expiry, '2028-01-15');

  // whichever date comes first is the expiry; a date bought or an order
  // time further on never is
  assert.deepEqual(parseRobinhoodOption('ACME $50 Call\nExpires Dec 18\nDate bought 1/2', TODAY), ACME);
  assert.deepEqual(parseRobinhoodOption('ACME $50 Call\n12/18 • 5 Buys\nJan 2', TODAY), ACME);
  assert.deepEqual(parseRobinhoodOption('Buy ACME $50 Call 12/18\nJan 2\n$100.00\n1 contract at $1.00', TODAY), ACME);

  // rejected shapes: no date, a month without a day, no such day, prose
  assert.equal(parseRobinhoodOption('ACME $50 Call', TODAY), null);
  assert.equal(parseRobinhoodOption('ACME $50 Call\nDec 2026', TODAY), null);
  assert.equal(parseRobinhoodOption('ACME $50 Call\nDecember', TODAY), null);
  assert.equal(parseRobinhoodOption('ACME $50 Call\nFeb 30', TODAY), null);
  assert.equal(parseRobinhoodOption('ACME $50 Call\nSept. 31', TODAY), null);
  assert.equal(parseRobinhoodOption('ACME $50 Call\nMarket value 12', TODAY), null);
  assert.equal(parseRobinhoodOption('ACME $50 Call\nToday 5', TODAY), null);
  assert.equal(parseRobinhoodOption('ACME $50 Call\nmay not be appropriate for 5 investors', TODAY), null);
  assert.equal(parseRobinhoodOption('ACME $50 Call\n41D', TODAY), null);

  // every Classic and Legend text reads exactly as before
  assert.deepEqual(parseRobinhoodOption(ROW_TEXT, TODAY), ACME);
  assert.deepEqual(parseRobinhoodOption(fixtureText('rh-row-classic.html'), TODAY), ACME);
  assert.deepEqual(parseRobinhoodOption('ACME $50 Call\n12/18/26 • 5 Buys', TODAY), ACME);
  assert.deepEqual(parseRobinhoodOption('SPY $650 Call / $660 Call\n9/18 • 1 Buy', TODAY), { ticker: 'SPY', strike: 650, type: 'call', expiry: '2026-09-18' });
  assert.deepEqual(parseRobinhoodOption(LEGEND_TEXT, LEGEND_TODAY), ZORK);
  assert.deepEqual(parseRobinhoodOption(fixtureText('rh-legend-row.html'), LEGEND_TODAY), ZORK);
  assert.deepEqual(parseRobinhoodOption('ZORK 10/16 $75 Call', LEGEND_TODAY), ZORK);
  assert.deepEqual(parseRobinhoodOption('ZORK 10/16/26 $75 Call', LEGEND_TODAY), ZORK);
  assert.equal(parseRobinhoodOption('XYZ 1/15 $100 Call\n497D', LEGEND_TODAY).expiry, '2028-01-15');
  assert.equal(parseRobinhoodOption('ZORK $75 Call\n41D', LEGEND_TODAY), null);
  assert.equal(parseRobinhoodOption('AAPL\n10 shares\n$1,234.56\n+1.20%', TODAY), null);

  // the squeezed build reads month names the same way
  const api = new Function(stripModule(readFileSync(MODULE_PATH, 'utf8')) + '\nreturn { parseRobinhoodOption };')();
  assert.deepEqual(api.parseRobinhoodOption('ACME $50 Call\nExpires Dec 18', TODAY), ACME);
  assert.equal(api.parseRobinhoodOption('ACME $50 Call\nSept. 18', TODAY).expiry, '2026-09-18');
  assert.deepEqual(api.parseRobinhoodOption(ROW_TEXT, TODAY), ACME);
  assert.equal(api.parseRobinhoodOption('ACME $50 Call', TODAY), null);
});

test('build-output', () => {
  const moduleSource = readFileSync(MODULE_PATH, 'utf8');

  // the line squeezer keeps string contents and only drops space next to punctuation
  assert.equal(squeezeLine("const a = { b: 'x y', c: \"p q\" };"), "const a={b:'x y',c:\"p q\"};");
  assert.equal(squeezeLine('return typeof x === \'string\' ? x : null;'), "return typeof x==='string'?x:null;");
  assert.equal(squeezeLine('const s = "a \\" b";'), 'const s="a \\" b";');
  assert.equal(squeezeLine('if (a - 1 > b) { return a - -1; }'), 'if(a - 1>b){return a - -1;}');

  const url = buildBookmarklet(moduleSource);
  assert.ok(url.startsWith('javascript:'), url.slice(0, 40));
  assert.equal(MAX_BYTES, 32768);
  assert.ok(Buffer.byteLength(url) < MAX_BYTES, 'bookmarklet is ' + Buffer.byteLength(url) + ' bytes');

  const body = decodeBookmarklet(url);
  assert.doesNotThrow(() => new Function(body));
  assert.ok(body.startsWith('(()=>{'));
  assert.ok(body.endsWith('main();})();'));
  assert.equal((body.match(/\bmain\(\);/g) || []).length, 1, 'exactly one main() call');
  assert.ok(!/\bexport\b/.test(body), 'no export keywords survive');
  assert.ok(!/@bookmarklet-strip/.test(body), 'the auto-run guard is removed');
  assert.ok(!/^\s*\/\//m.test(body), 'no comment lines survive');

  // the squeezed script behaves like the module it was built from
  const api = new Function(stripModule(moduleSource) + '\nreturn { parseRobinhoodOption, toOsiSymbol, buildUnusualWhalesUrl, countContracts, highlightRect, BANNER_TEXT, UW_BLUE };')();
  assert.deepEqual(api.parseRobinhoodOption(ROW_TEXT, TODAY), parseRobinhoodOption(ROW_TEXT, TODAY));
  assert.deepEqual(api.parseRobinhoodOption(LEGEND_TEXT, LEGEND_TODAY), ZORK);
  assert.equal(api.buildUnusualWhalesUrl(api.toOsiSymbol(api.parseRobinhoodOption(ROW_TEXT, TODAY))), ACME_URL);
  assert.equal(api.countContracts(LEGEND_TEXT), 1);
  assert.deepEqual(api.highlightRect({ left: 10, top: 20, width: 100, height: 40 }), highlightRect({ left: 10, top: 20, width: 100, height: 40 }));
  assert.equal(api.BANNER_TEXT, BANNER_TEXT);
  assert.equal(api.UW_BLUE, UW_BLUE);

  // the committed artifact is a fresh build
  const committed = readFileSync(OUTPUT_PATH, 'utf8').trim();
  assert.equal(committed, url, 'rh-to-uw.bookmarklet.txt is stale; run node src/rh-to-uw/build.mjs');
  assert.ok(committed.startsWith('javascript:'));
  assert.ok(Buffer.byteLength(committed) < MAX_BYTES);
  assert.doesNotThrow(() => new Function(decodeBookmarklet(committed)));

  // the install page is generated from the same URL and must not go stale either
  assert.ok(INSTALL_PATH.endsWith(join('docs', 'index.html')), 'the install page is what GitHub Pages serves');
  const page = readFileSync(INSTALL_PATH, 'utf8');
  assert.equal(page, buildInstallPage(url), 'install.html is stale; run node src/rh-to-uw/build.mjs');
  assert.ok(page.includes('href="' + url + '"'), 'the drag link carries the built bookmarklet');
  assert.ok(!/<script|src=|@import|url\(/.test(page), 'the page loads nothing');
  assert.throws(() => buildInstallPage('javascript:a"b'));
  assert.throws(() => buildInstallPage('https://example.com/'));
});

// --- in-page behaviour against a tiny fake DOM -----------------------------

// A fake element: its own text or the text of its children joined by line
// breaks, attributes behind getAttribute, a bounding rect when one is given
// (read live from node.rect so a test can move it), a children/parentElement
// tree, and a style object that records every write.
function fakeEl(spec) {
  const attrs = spec.attrs || {};
  const node = {
    nodeType: 1,
    parentElement: null,
    children: [],
    style: {},
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
  };
  if (spec.text !== undefined) {
    node.innerText = spec.text;
  } else {
    Object.defineProperty(node, 'innerText', {
      get() {
        return node.children.map((c) => c.innerText).filter((t) => typeof t === 'string' && t !== '').join('\n');
      },
    });
  }
  if (spec.rect) {
    node.rect = spec.rect;
    node.getBoundingClientRect = () => {
      const r = node.rect;
      return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height };
    };
  }
  for (const child of spec.children || []) {
    child.parentElement = node;
    node.children.push(child);
  }
  return node;
}

// document, window and body doubles shared by every fake DOM
function fakeEnv() {
  const listeners = [];
  const winListeners = [];
  const children = [];
  const body = {
    style: { cursor: '' },
    appendChild(el) {
      el.parentNode = body;
      children.push(el);
    },
    removeChild(el) {
      const i = children.indexOf(el);
      if (i >= 0) {
        children.splice(i, 1);
      }
      el.parentNode = null;
    },
  };
  const doc = {
    body,
    title: '',
    createElement(tag) {
      const attributes = {};
      return {
        tagName: tag,
        textContent: '',
        parentNode: null,
        attributes,
        style: {},
        setAttribute(name, value) {
          attributes[name] = String(value);
        },
      };
    },
    addEventListener(type, fn, opts) {
      listeners.push({ type, fn, capture: typeof opts === 'object' && opts !== null ? Boolean(opts.capture) : Boolean(opts) });
    },
    removeEventListener(type, fn) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) {
        listeners.splice(i, 1);
      }
    },
  };
  const calls = { open: [], assign: [], alert: [] };
  const win = {
    __rhToUw: undefined,
    popupBlocked: false,
    open(url) {
      calls.open.push(url);
      return win.popupBlocked ? null : { opener: {} };
    },
    location: { assign(url) { calls.assign.push(url); } },
    alert(msg) { calls.alert.push(msg); },
    addEventListener(type, fn) {
      winListeners.push({ type, fn });
    },
    removeEventListener(type, fn) {
      const i = winListeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) {
        winListeners.splice(i, 1);
      }
    },
  };
  const fire = (list, type, event) => {
    for (const l of list.slice()) {
      if (l.type === type) {
        l.fn(event);
      }
    }
  };
  return {
    doc,
    win,
    calls,
    listeners,
    winListeners,
    children,
    dispatch: (type, event) => fire(listeners, type, event),
    dispatchWin: (type, event) => fire(winListeners, type, event),
  };
}

// The original bare three-level DOM: no attributes, no rects, no children.
function fakeDom(rowText) {
  const list = { nodeType: 1, innerText: 'Options\n' + rowText, parentElement: null };
  const row = { nodeType: 1, innerText: rowText, parentElement: list };
  const cell = { nodeType: 1, innerText: rowText.split('\n')[0], parentElement: row };
  const textNode = { nodeType: 3, parentElement: cell };
  return Object.assign(fakeEnv(), { list, row, cell, textNode });
}

const ZORK_KEY = 'optionLeg-00000000-0000-4000-8000-000000000001:buy:1.00000000-0000-4000-8000-000000000001';
const SPY_KEY = 'optionLeg-5b1d0c2e-7f7a-4a8e-9a6b-3c2d1e0f9a8b:sell:1.5b1d0c2e-7f7a-4a8e-9a6b-3c2d1e0f9a8b';
const AAPL_KEY = 'equity-0f9e8d7c-6b5a-4433-9211-ffeeddccbbaa';
const LEGEND_COLUMNS = ['TOTAL_RETURN_PCT', 'QUANTITY', 'AVERAGE_COST', 'MARKET_VALUE', 'TODAY_RETURN', 'TODAY_RETURN_PCT', 'DAYS_TO_EXPIRATION'];

// One Legend positions-grid row shaped like fixtures/rh-legend-row.html:
// a flex wrapper holding the instrument cell, then a grid wrapper holding a
// padding div, the value cells and another padding div. Every cell carries
// data-cell-id "<key>_POSITION_COLUMN_NAME_<column>".
function legendRow(key, name, values, top) {
  const h = 40;
  const nameSpan = fakeEl({ text: name, rect: { left: 16, top: top + 12, width: 160, height: 16 } });
  const nameCell = fakeEl({
    attrs: { role: 'gridcell', 'data-cell-id': key + '_POSITION_COLUMN_NAME_INSTRUMENT' },
    rect: { left: 8, top, width: 200, height: h },
    children: [fakeEl({ children: [nameSpan] })],
  });
  const cells = {};
  const valueText = {};
  const gridChildren = [fakeEl({})];
  LEGEND_COLUMNS.forEach((column, i) => {
    const span = fakeEl({ text: values[i], rect: { left: 216 + i * 80, top: top + 12, width: 64, height: 16 } });
    const cell = fakeEl({
      attrs: { role: 'gridcell', 'data-cell-id': key + '_POSITION_COLUMN_NAME_' + column },
      rect: { left: 208 + i * 80, top, width: 80, height: h },
      children: [fakeEl({ children: [span] })],
    });
    cells[column] = cell;
    valueText[column] = span;
    gridChildren.push(cell);
  });
  gridChildren.push(fakeEl({}));
  const flex = fakeEl({ rect: { left: 8, top, width: 200, height: h }, children: [nameCell] });
  const grid = fakeEl({ rect: { left: 208, top, width: 560, height: h }, children: gridChildren });
  const row = fakeEl({ attrs: { role: 'row' }, rect: { left: 8, top, width: 800, height: h }, children: [flex, grid] });
  return { row, flex, grid, nameCell, nameSpan, cells, valueText };
}

// Two option legs and one stock position inside a role=rowgroup, under a
// role=grid with a header row, on a page with a nav bar above it.
function fakeLegendDom() {
  const zork = legendRow(ZORK_KEY, 'ZORK 10/16 $75 Call', ['12.34%', '3', '$1.23', '$1,234.00', '$123.00', '4.56%', '41D'], 100);
  const spy = legendRow(SPY_KEY, 'SPY 12/18 $650 Put', ['-12.00%', '2', '$8.10', '$1,425.00', '-$60.00', '-4.04%', '104D'], 140);
  const stock = legendRow(AAPL_KEY, 'AAPL', ['+1.20%', '10', '$150.00', '$1,234.56', '+$12.00', '+0.98%', ''], 180);
  const header = fakeEl({ attrs: { role: 'row' }, text: 'Name\nTotal return\nQty\nAvg cost\nMarket value\nToday\nToday %\nDTE', rect: { left: 8, top: 60, width: 800, height: 40 } });
  const rowgroup = fakeEl({ attrs: { role: 'rowgroup' }, rect: { left: 8, top: 100, width: 800, height: 120 }, children: [zork.row, spy.row, stock.row] });
  const grid = fakeEl({ attrs: { role: 'grid' }, rect: { left: 8, top: 60, width: 800, height: 160 }, children: [header, rowgroup] });
  const nav = fakeEl({ text: 'Robinhood\nLegend\nPositions', rect: { left: 0, top: 0, width: 816, height: 60 } });
  const page = fakeEl({ rect: { left: 0, top: 0, width: 816, height: 900 }, children: [nav, grid] });
  return Object.assign(fakeEnv(), { zork, spy, stock, header, rowgroup, grid, nav, page });
}

// One Classic position row shaped like fixtures/rh-row-classic.html: a row of
// height 48 holding a left block (name over expiry line) and a right block
// (the amounts), both 40 tall and side by side.
function classicRow(name, expiryLine, values, top) {
  const nameSpan = fakeEl({ text: name, rect: { left: 24, top: top + 6, width: 140, height: 18 } });
  const expirySpan = fakeEl({ text: expiryLine, rect: { left: 24, top: top + 26, width: 140, height: 16 } });
  const left = fakeEl({
    rect: { left: 16, top: top + 4, width: 200, height: 40 },
    children: [fakeEl({ children: [nameSpan] }), fakeEl({ children: [fakeEl({ children: [expirySpan] })] })],
  });
  const valueSpans = values.map((value, i) => fakeEl({ text: value, rect: { left: 320, top: top + 6 + i * 20, width: 80, height: 16 } }));
  const right = fakeEl({ rect: { left: 216, top: top + 4, width: 200, height: 40 }, children: [fakeEl({ children: valueSpans })] });
  const row = fakeEl({ rect: { left: 16, top, width: 400, height: 48 }, children: [left, right] });
  return { row, left, right, nameSpan, expirySpan, valueSpans };
}

// Option rows and a stock row in one list under an "Options" heading. With
// {single: true} the list holds one option row and the stock row only.
function fakeClassicDom(opts) {
  const single = Boolean(opts && opts.single);
  const acme = classicRow('ACME $50 Call', '12/18 • 5 Buys', ['-$250.00', '-25.00%'], 200);
  const spy = classicRow('SPY $650 Call', '9/18 • 1 Buy', ['+$200.00', '+10.00%'], 248);
  const stock = classicRow('AAPL', '10 shares', ['$1,234.56', '+1.20%'], single ? 248 : 296);
  const rows = single ? [acme.row, stock.row] : [acme.row, spy.row, stock.row];
  const list = fakeEl({ rect: { left: 16, top: 200, width: 400, height: rows.length * 48 }, children: rows });
  const heading = fakeEl({ text: 'Options', rect: { left: 16, top: 170, width: 400, height: 30 } });
  const page = fakeEl({ rect: { left: 0, top: 0, width: 432, height: 900 }, children: [heading, list] });
  return Object.assign(fakeEnv(), { acme, spy, stock, list, heading, page });
}

// The option detail page shaped like fixtures/rh-option-detail-page.html:
// under the ticker line, a header block holding the h1 "ACME $50 Call" and
// the "Legend chart" link; then the chart, the "Your position" cards,
// Stats, the Greeks, History and the footnote. card: true puts the card
// with the "Expiration date" value in, 'dateless' one with only the date
// bought; history: 'same' adds the row "Buy ACME $50 Call 12/18", 'other'
// the row "Sell ACME $55 Put 12/18"; title is the document title.
function fakeDetailDom(opts) {
  const o = opts || {};
  const h1 = fakeEl({ text: 'ACME $50 Call', rect: { left: 24, top: 80, width: 180, height: 32 } });
  const linkText = fakeEl({ text: 'Legend chart', rect: { left: 220, top: 86, width: 90, height: 20 } });
  const link = fakeEl({
    attrs: { role: 'link', 'aria-label': 'View legend chart' },
    rect: { left: 216, top: 82, width: 100, height: 28 },
    children: [fakeEl({ children: [linkText] })],
  });
  const header = fakeEl({ rect: { left: 24, top: 76, width: 400, height: 40 }, children: [h1, link] });
  const ticker = fakeEl({
    rect: { left: 24, top: 40, width: 400, height: 32 },
    children: [fakeEl({ text: 'ACME' }), fakeEl({ text: '$49.55 (-0.47%)' }), fakeEl({ text: 'Late close' })],
  });
  const top = fakeEl({ rect: { left: 24, top: 40, width: 400, height: 80 }, children: [ticker, header] });
  const hero = fakeEl({ rect: { left: 24, top: 40, width: 400, height: 80 }, children: [top] });
  const chart = fakeEl({ text: '$1.23\n-$0.10 (-1.00%)\nToday', rect: { left: 24, top: 120, width: 400, height: 300 } });
  const label = fakeEl({ text: 'Expiration date', rect: { left: 240, top: 480, width: 120, height: 16 } });
  const value = fakeEl({ text: '12/18', rect: { left: 240, top: 500, width: 60, height: 24 } });
  const costTable = fakeEl({ text: 'Average cost\n$1.00\nACME breakeven price\n$51.00\nContracts\n+1\nDate bought\n1/2' });
  const expiryCard = fakeEl({
    rect: { left: 232, top: 470, width: 200, height: 180 },
    children: o.card === 'dateless' ? [costTable] : [fakeEl({ children: [label, value] }), costTable],
  });
  const valueCard = fakeEl({
    rect: { left: 24, top: 470, width: 200, height: 180 },
    children: [
      fakeEl({ children: [fakeEl({ text: 'Market value' }), fakeEl({ text: '$1,234.00' })] }),
      fakeEl({ text: 'Current price\n$1.23\nCurrent ACME price\n$49.55\nToday’s return\n-$12.34 (-1.00%)\nTotal return\n+$123.00 (+10.00%)\nSimulate my returns' }),
    ],
  });
  const position = fakeEl({
    rect: { left: 24, top: 440, width: 400, height: 220 },
    children: [fakeEl({ text: 'Your position' }), fakeEl({ children: [valueCard, expiryCard] })],
  });
  const stats = fakeEl({ text: 'Stats\nBid\n$1.20 × 10\nImplied volatility\n10.00%', rect: { left: 24, top: 660, width: 400, height: 60 } });
  const greeks = fakeEl({ text: 'The Greeks\nDelta\n0.5000', rect: { left: 24, top: 720, width: 400, height: 40 } });
  const h3 = fakeEl({ text: o.history === 'same' ? 'Buy ACME $50 Call 12/18' : 'Sell ACME $55 Put 12/18', rect: { left: 24, top: 800, width: 300, height: 20 } });
  const order = fakeEl({
    rect: { left: 24, top: 790, width: 400, height: 60 },
    children: [
      fakeEl({ children: [h3, fakeEl({ text: 'Jan 2' })] }),
      fakeEl({ text: '$100.00\n1 contract at $1.00' }),
      fakeEl({ text: 'Type\nLimit buy\nSubmitted\n1/2, 10:44 AM PDT' }),
    ],
  });
  const history = fakeEl({ rect: { left: 24, top: 760, width: 400, height: 100 }, children: [fakeEl({ text: 'History' }), order] });
  const footer = fakeEl({ text: 'Past performance does not guarantee future results. Options carry significant risk and may not be appropriate for all investors.' });
  const nav = fakeEl({ text: 'Robinhood\nInvesting\nOptions', rect: { left: 0, top: 0, width: 800, height: 40 } });
  const children = [nav, hero, chart];
  if (o.card) {
    children.push(position);
  }
  children.push(stats, greeks);
  if (o.history) {
    children.push(history);
  }
  children.push(footer);
  const page = fakeEl({ rect: { left: 0, top: 0, width: 800, height: 900 }, children });
  const env = fakeEnv();
  env.doc.title = o.title || '';
  return Object.assign(env, { h1, linkText, link, header, top, hero, page, label, value, h3, order, position, nav });
}

const CHAIN_METRIC_CELLS = ['OptionChainCustomMetricOneCell', 'OptionChainCustomMetricTwoCell', 'OptionChainPercentChangeCell', 'OptionChainChangeCell'];
const CHAIN_IDS = ['50.00', '52.50', '55.00'];
const CHAIN_CELLS = [
  ['$50', '$50.18', '+0.36%', '-12.34%', '-$0.10', '$0.18'],
  ['$52.50', '$52.60', '+5.19%', '-20.00%', '-$0.02', '$0.10'],
  ['$55', '$55.05', '+10.10%', '-28.57%', '-$0.02', '$0.05'],
];

// One option chain row shaped like fixtures/rh-chain-row.html: the strike
// cell, four metric cells and the price cell whose button starts an order,
// all inside the element carrying data-testid "ChainTableRow-<id>", which
// sits in a wrapper beside a collapsed detail div.
function chainRow(id, cells, top) {
  const h = 44;
  const strikeText = fakeEl({ text: cells[0], rect: { left: 24, top: top + 12, width: 40, height: 20 } });
  const strikeCell = fakeEl({
    attrs: { 'data-testid': 'OptionChainStrikePriceCell' },
    rect: { left: 16, top, width: 120, height: h },
    children: [fakeEl({ children: [strikeText] })],
  });
  const metrics = CHAIN_METRIC_CELLS.map((testid, i) => fakeEl({
    attrs: { 'data-testid': testid },
    rect: { left: 136 + i * 120, top, width: 120, height: h },
    children: [fakeEl({ children: [fakeEl({ text: cells[i + 1] })] })],
  }));
  const priceText = fakeEl({ text: cells[5], rect: { left: 624, top: top + 12, width: 40, height: 20 } });
  const button = fakeEl({
    attrs: { type: 'button', 'data-testid': 'OptionChainSelectRowButton' },
    rect: { left: 616, top: top + 6, width: 100, height: 32 },
    children: [priceText, fakeEl({ children: [fakeEl({ children: [fakeEl({})] }), fakeEl({ children: [fakeEl({})] })] })],
  });
  const priceCell = fakeEl({
    attrs: { 'data-testid': 'OptionChainValidPriceCell' },
    rect: { left: 616, top, width: 120, height: h },
    children: [fakeEl({ children: [button] })],
  });
  const row = fakeEl({
    attrs: { 'data-testid': 'ChainTableRow-' + id },
    rect: { left: 16, top, width: 720, height: h },
    children: [strikeCell].concat(metrics, [priceCell]),
  });
  const wrapper = fakeEl({ rect: { left: 16, top, width: 720, height: h }, children: [row, fakeEl({})] });
  return { row, wrapper, strikeText, strikeCell, metrics, priceText, button, priceCell };
}

// The option chain page shaped like fixtures/rh-chain-header.html over
// three rows shaped like fixtures/rh-chain-row.html: a chart section whose
// header holds the ticker badge twice, the company name, the market price
// and the "ACME buy Call" h1; a footer with the Builder link, the Buy/Sell
// and Call/Put toggles and the expiry control, then the column headings;
// then the rows. heading replaces the h1 text and expiring the control's
// button text; ids and cells replace the rows' strikes in their data-testid
// and their cell texts; control: false drops the control's data-testid.
function fakeChainDom(opts) {
  const o = opts || {};
  const badge = () => fakeEl({ children: [fakeEl({ text: 'ACME' }), fakeEl({ text: '$49.55 (-0.47%)' }), fakeEl({ text: 'Late close' })] });
  const h1 = fakeEl({ text: o.heading || 'ACME buy Call', rect: { left: 24, top: 150, width: 200, height: 32 } });
  const price = fakeEl({ text: '$49.55\n-$0.24 (-0.38%) Today\n-$0.05 (-0.09%) After Hours' });
  const chartHeader = fakeEl({
    rect: { left: 16, top: 60, width: 720, height: 130 },
    children: [fakeEl({ children: [badge(), fakeEl({ text: 'Acme Corp' }), price] }), fakeEl({ children: [badge(), h1] }), fakeEl({ text: 'Price History' })],
  });
  const chart = fakeEl({ text: '1D\n1W\n1M\n3M\nYTD\n1Y\nAll', rect: { left: 16, top: 190, width: 720, height: 300 } });
  const section = fakeEl({ attrs: { 'data-testid': 'ChartSection' }, rect: { left: 16, top: 60, width: 720, height: 430 }, children: [chartHeader, chart] });
  const expiring = fakeEl({ text: o.expiring || 'Expiring December 18 (104d)', rect: { left: 424, top: 502, width: 200, height: 20 } });
  const button = fakeEl({
    attrs: { role: 'combobox', 'aria-label': 'Expiration Date', 'aria-expanded': 'false' },
    rect: { left: 416, top: 496, width: 240, height: 32 },
    children: [fakeEl({ children: [expiring] }), fakeEl({ children: [fakeEl({})] })],
  });
  const control = fakeEl({
    attrs: o.control === false ? {} : { 'data-testid': 'SelectExpirationDateDropdown' },
    rect: { left: 416, top: 496, width: 240, height: 32 },
    children: [fakeEl({ children: [fakeEl({ children: [button] })] })],
  });
  const toggle = (testid, a, b) => fakeEl({ attrs: { 'data-testid': testid }, children: [fakeEl({ children: [fakeEl({ text: a })] }), fakeEl({ children: [fakeEl({ text: b })] })] });
  const side = toggle('OptionChainSideControl', 'Buy', 'Sell');
  const type = toggle('OptionChainOptionTypeControl', 'Call', 'Put');
  const controls = fakeEl({ rect: { left: 16, top: 490, width: 720, height: 44 }, children: [fakeEl({ children: [fakeEl({ text: 'Builder' })] }), side, type, control] });
  const columns = fakeEl({ text: 'Strike price\nBreakeven\nTo breakeven\n% Change\nChange\nPrice', rect: { left: 16, top: 534, width: 720, height: 30 } });
  const footer = fakeEl({ rect: { left: 16, top: 490, width: 720, height: 74 }, children: [controls, columns] });
  const ids = o.ids || CHAIN_IDS;
  const cells = o.cells || CHAIN_CELLS;
  const rows = ids.map((id, i) => chainRow(id, cells[i], 564 + i * 44));
  const list = fakeEl({
    rect: { left: 16, top: 564, width: 720, height: rows.length * 44 },
    children: [fakeEl({ children: [fakeEl({ children: [fakeEl({ children: rows.map((r) => r.wrapper) })] })] })],
  });
  const chain = fakeEl({ rect: { left: 16, top: 60, width: 720, height: 504 + rows.length * 44 }, children: [fakeEl({ children: [section, footer] }), list] });
  const nav = fakeEl({ text: 'Robinhood\nInvesting\nOptions', rect: { left: 0, top: 0, width: 752, height: 60 } });
  const page = fakeEl({ rect: { left: 0, top: 0, width: 752, height: 900 }, children: [nav, chain] });
  return Object.assign(fakeEnv(), { h1, expiring, button, control, side, type, columns, footer, rows, list, chain, nav, page });
}

function fakeEvent(target, key) {
  return {
    target,
    key,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() {},
  };
}

function overlaysOf(d) {
  return d.children.filter((el) => el.attributes && el.attributes['data-rh-to-uw'] === 'highlight');
}

function hoverListeners(d) {
  return d.listeners.filter((l) => l.type === 'mouseover' || l.type === 'scroll').length
    + d.winListeners.filter((l) => l.type === 'resize').length;
}

test('picker', () => {
  const expected = buildUnusualWhalesUrl(toOsiSymbol(parseRobinhoodOption(ROW_TEXT)));

  // findContract walks up from any node inside the row and stops at the row
  {
    const d = fakeDom(ROW_TEXT);
    assert.deepEqual(findContract(d.textNode, TODAY), parseRobinhoodOption(ROW_TEXT, TODAY));
    assert.deepEqual(findContract(d.cell, TODAY), parseRobinhoodOption(ROW_TEXT, TODAY));
    assert.equal(findContract(null, TODAY), null);
    assert.equal(findContract({ nodeType: 1, innerText: 'nothing here', parentElement: null }, TODAY), null);
  }

  // arm, click the row: capture-phase handler, Robinhood click suppressed, new tab, full cleanup
  {
    const d = fakeDom(ROW_TEXT);
    const state = armPicker(d.doc, d.win);
    assert.equal(d.win.__rhToUw, state);
    assert.equal(d.doc.body.style.cursor, 'crosshair');
    assert.equal(d.children.length, 1);
    assert.equal(d.children[0].textContent, BANNER_TEXT);
    const clicks = d.listeners.filter((l) => l.type === 'click');
    assert.equal(clicks.length, 1);
    assert.equal(clicks[0].capture, true);
    const ev = fakeEvent(d.cell);
    d.dispatch('click', ev);
    assert.equal(ev.prevented, true);
    assert.equal(ev.stopped, true);
    assert.deepEqual(d.calls.open, [expected]);
    assert.deepEqual(d.calls.assign, []);
    assert.deepEqual(d.calls.alert, []);
    assert.equal(d.listeners.length, 0);
    assert.equal(d.winListeners.length, 0);
    assert.equal(d.children.length, 0);
    assert.equal(d.doc.body.style.cursor, '');
    assert.equal(d.win.__rhToUw, null);
  }

  // clicking something that is not an option row alerts and disarms, no navigation
  {
    const d = fakeDom('AAPL\n10 shares\n$1,234.56');
    armPicker(d.doc, d.win);
    const ev = fakeEvent(d.cell);
    d.dispatch('click', ev);
    assert.equal(ev.prevented, true);
    assert.deepEqual(d.calls.alert, [NO_CONTRACT_TEXT]);
    assert.deepEqual(d.calls.open, []);
    assert.deepEqual(d.calls.assign, []);
    assert.equal(d.listeners.length, 0);
    assert.equal(d.children.length, 0);
    assert.equal(d.win.__rhToUw, null);
  }

  // Escape cancels everything
  {
    const d = fakeDom(ROW_TEXT);
    armPicker(d.doc, d.win);
    d.dispatch('keydown', fakeEvent(d.row, 'a'));
    // click, keydown, mouseover and scroll on the document; resize on the window
    assert.equal(d.listeners.length, 4);
    assert.equal(d.winListeners.length, 1);
    d.dispatch('keydown', fakeEvent(d.row, 'Escape'));
    assert.equal(d.listeners.length, 0);
    assert.equal(d.winListeners.length, 0);
    assert.equal(d.children.length, 0);
    assert.equal(d.doc.body.style.cursor, '');
    assert.deepEqual(d.calls.open, []);
    assert.equal(d.win.__rhToUw, null);
    // a click after cancelling reaches nobody
    d.dispatch('click', fakeEvent(d.cell));
    assert.deepEqual(d.calls.open, []);
  }

  // arming twice replaces the first arm; exactly one listener and one banner stay
  {
    const d = fakeDom(ROW_TEXT);
    const first = armPicker(d.doc, d.win);
    const second = armPicker(d.doc, d.win);
    assert.notEqual(first, second);
    assert.equal(d.win.__rhToUw, second);
    assert.equal(d.listeners.filter((l) => l.type === 'click').length, 1);
    assert.equal(d.listeners.filter((l) => l.type === 'keydown').length, 1);
    assert.equal(d.children.length, 1);
    d.dispatch('click', fakeEvent(d.cell));
    assert.deepEqual(d.calls.open, [expected]);
    assert.equal(d.listeners.length, 0);
  }

  // popup blocked: same-tab navigation
  {
    const d = fakeDom(ROW_TEXT);
    d.win.popupBlocked = true;
    armPicker(d.doc, d.win);
    d.dispatch('click', fakeEvent(d.cell));
    assert.deepEqual(d.calls.open, [expected]);
    assert.deepEqual(d.calls.assign, [expected]);
  }

  // importing the module under Node never touched a document
  assert.equal(typeof globalThis.document, 'undefined');
  assert.throws(() => armPicker(undefined, undefined));
});

// The armed banner carries a 2px frame in the Unusual Whales blue on the same
// single inline style string as before: still fixed, still centred by its
// transform, still ignoring the pointer, and gone again on cleanup.
test('banner-border', () => {
  assert.equal(UW_BLUE, '#52A3CF');
  const d = fakeDom(ROW_TEXT);
  const state = armPicker(d.doc, d.win);
  assert.equal(d.children.length, 1);
  const banner = d.children[0];
  assert.equal(banner.textContent, BANNER_TEXT);
  const style = banner.attributes.style;
  assert.equal(typeof style, 'string');
  assert.ok(style.includes('border:2px solid #52A3CF'), style);
  assert.ok(style.includes('position:fixed'), style);
  assert.ok(style.includes('transform:translateX(-50%)'), style);
  assert.ok(style.includes('pointer-events:none'), style);
  assert.ok(style.includes('background:#111'), style);
  state.cleanup();
  assert.equal(d.children.length, 0);
  assert.equal(d.win.__rhToUw, null);

  // re-arming replaces the banner and the new one carries the frame too
  {
    const d2 = fakeDom(ROW_TEXT);
    armPicker(d2.doc, d2.win);
    armPicker(d2.doc, d2.win);
    assert.equal(d2.children.length, 1);
    assert.ok(d2.children[0].attributes.style.includes('border:2px solid ' + UW_BLUE));
    d2.dispatch('keydown', fakeEvent(d2.row, 'Escape'));
    assert.equal(d2.children.length, 0);
  }

  // the squeezed build keeps the space inside "2px solid": it sits in a string literal
  {
    const api = new Function(stripModule(readFileSync(MODULE_PATH, 'utf8')) + '\nreturn { armPicker };')();
    const d3 = fakeDom(ROW_TEXT);
    api.armPicker(d3.doc, d3.win);
    assert.equal(d3.children.length, 1);
    assert.ok(d3.children[0].attributes.style.includes('border:2px solid #52A3CF'), d3.children[0].attributes.style);
    d3.dispatch('keydown', fakeEvent(d3.row, 'Escape'));
    assert.equal(d3.children.length, 0);
  }
});

test('row-target', () => {
  // Legend: every cell of a leg shares one data-cell-id key, so the row is
  // the common parent just below the rowgroup, from any cell of the leg
  {
    const d = fakeLegendDom();
    const starts = [d.zork.nameSpan, d.zork.nameCell, d.zork.cells.MARKET_VALUE, d.zork.valueText.MARKET_VALUE, d.zork.cells.DAYS_TO_EXPIRATION];
    for (const start of starts) {
      const hit = findRow(start, LEGEND_TODAY);
      assert.ok(hit, 'row found from every cell');
      assert.equal(hit.el, d.zork.row);
      assert.notEqual(hit.el, d.rowgroup);
      assert.deepEqual(hit.contract, ZORK);
    }
    const spy = findRow(d.spy.valueText.QUANTITY, LEGEND_TODAY);
    assert.equal(spy.el, d.spy.row);
    assert.deepEqual(spy.contract, { ticker: 'SPY', strike: 650, type: 'put', expiry: '2026-12-18' });
    // a stock row, the header, the rowgroup, the grid and the page are not option rows
    assert.equal(findRow(d.stock.nameSpan, LEGEND_TODAY), null);
    assert.equal(findRow(d.stock.cells.MARKET_VALUE, LEGEND_TODAY), null);
    assert.equal(findRow(d.header, LEGEND_TODAY), null);
    assert.equal(findRow(d.rowgroup, LEGEND_TODAY), null);
    assert.equal(findRow(d.grid, LEGEND_TODAY), null);
    assert.equal(findRow(d.nav, LEGEND_TODAY), null);
    assert.equal(findRow(d.page, LEGEND_TODAY), null);
    // findContract is the same lookup without the element
    assert.deepEqual(findContract(d.zork.cells.MARKET_VALUE, LEGEND_TODAY), ZORK);
    assert.deepEqual(findContract(d.zork.nameSpan, LEGEND_TODAY), ZORK);
    assert.equal(findContract(d.stock.nameSpan, LEGEND_TODAY), null);
  }

  // Classic: the innermost parsing block is the left block (height 40); the
  // climb stops at the row (height 48), never at the list
  {
    const d = fakeClassicDom();
    const starts = [d.acme.nameSpan, d.acme.expirySpan, d.acme.left, d.acme.valueSpans[0], d.acme.right];
    for (const start of starts) {
      const hit = findRow(start, TODAY);
      assert.ok(hit, 'row found from every part of the row');
      assert.equal(hit.el, d.acme.row);
      assert.equal(hit.el.rect.height, 48);
      assert.notEqual(hit.el, d.acme.left);
      assert.notEqual(hit.el, d.list);
      assert.deepEqual(hit.contract, ACME);
    }
    assert.equal(findRow(d.spy.nameSpan, TODAY).el, d.spy.row);
    assert.equal(findRow(d.spy.valueSpans[1], TODAY).el, d.spy.row);
    assert.equal(findRow(d.stock.nameSpan, TODAY), null);
    assert.equal(findRow(d.stock.valueSpans[0], TODAY), null);
    assert.equal(findRow(d.list, TODAY), null);
    assert.equal(findRow(d.heading, TODAY), null);
    assert.equal(findRow(d.page, TODAY), null);
    assert.deepEqual(findContract(d.acme.nameSpan, TODAY), ACME);
    assert.deepEqual(findContract(d.acme.valueSpans[1], TODAY), ACME);
    assert.equal(findContract(d.stock.nameSpan, TODAY), null);

    // one option beside stock rows: the list holds a single contract but is
    // more than 1.5x the row, so the row still wins and the stock row is nothing
    const one = fakeClassicDom({ single: true });
    assert.equal(one.list.rect.height, 96);
    assert.equal(findRow(one.acme.nameSpan, TODAY).el, one.acme.row);
    assert.equal(findRow(one.acme.valueSpans[0], TODAY).el, one.acme.row);
    assert.equal(findRow(one.stock.nameSpan, TODAY), null);
    assert.equal(findRow(one.stock.valueSpans[0], TODAY), null);
    assert.equal(findRow(one.heading, TODAY), null);
    assert.equal(findRow(one.page, TODAY), null);
  }

  // no attributes and no rects: the innermost parsing element is the row
  {
    const d = fakeDom(ROW_TEXT);
    assert.equal(findRow(d.textNode, TODAY).el, d.row);
    assert.equal(findRow(d.cell, TODAY).el, d.row);
    assert.deepEqual(findRow(d.cell, TODAY).contract, ACME);
    assert.equal(findRow(null, TODAY), null);
    assert.equal(findRow({ nodeType: 1, innerText: 'nothing here', parentElement: null }, TODAY), null);
  }
});

test('chain-row', () => {
  // the fixtures: a row is only its strike and prices; the heading and the
  // expiry control above the rows carry the rest, and neither text is a
  // contract on its own
  assert.equal(fixtureText('rh-chain-row.html'), CHAIN_ROW_TEXT);
  const header = fixtureText('rh-chain-header.html');
  assert.ok(header.includes('ACME buy Call\nPrice History'), header);
  assert.ok(header.includes('Buy\nSell\nCall\nPut\nExpiring December 18 (104d)\nStrike price'), header);
  assert.equal(countContracts(header + '\n' + CHAIN_ROW_TEXT), 0);
  assert.equal(parseRobinhoodOption(CHAIN_ROW_TEXT, CHAIN_TODAY), null);
  assert.equal(parseRobinhoodOption(header, CHAIN_TODAY), null);

  // from the fixture texts alone, with no control element: the strike from
  // the row's testid, the rest from the heading and the first Expiring
  // phrase in the page's text
  {
    const d = fakeEnv();
    const cell = fakeEl({ text: '$50' });
    const row = fakeEl({ attrs: { 'data-testid': 'ChainTableRow-50.00' }, children: [cell, fakeEl({ text: CHAIN_ROW_TEXT.slice(4) })] });
    const page = fakeEl({ children: [fakeEl({ text: header }), fakeEl({ children: [row] })] });
    assert.equal(findRow(cell, CHAIN_TODAY, d.doc).el, row);
    assert.deepEqual(findContract(cell, CHAIN_TODAY, d.doc), ACME);
    assert.equal(findRow(page, CHAIN_TODAY, d.doc), null);
  }

  // the fake page: from every part of the $50 row the hit is the element
  // carrying the row testid, never a cell, the wrapper or the list
  {
    const d = fakeChainDom();
    const r = d.rows[0];
    const starts = [r.strikeText, r.strikeCell, r.metrics[0], r.metrics[3], r.priceText, r.button, r.priceCell, r.row];
    for (const start of starts) {
      const hit = findRow(start, CHAIN_TODAY, d.doc);
      assert.ok(hit, 'row found from every cell');
      assert.equal(hit.el, r.row);
      assert.notEqual(hit.el, r.wrapper);
      assert.deepEqual(hit.contract, ACME);
    }
    assert.equal(findRow(r.wrapper, CHAIN_TODAY, d.doc), null);
    assert.equal(buildUnusualWhalesUrl(toOsiSymbol(findContract(r.priceText, CHAIN_TODAY, d.doc))), ACME_URL);
    // the other strikes, one with cents
    assert.equal(findRow(d.rows[1].strikeText, CHAIN_TODAY, d.doc).el, d.rows[1].row);
    assert.deepEqual(findContract(d.rows[1].strikeText, CHAIN_TODAY, d.doc), { ticker: 'ACME', strike: 52.5, type: 'call', expiry: '2026-12-18' });
    assert.equal(toOsiSymbol(findContract(d.rows[1].priceText, CHAIN_TODAY, d.doc)), 'ACME261218C00052500');
    assert.deepEqual(findContract(d.rows[2].metrics[1], CHAIN_TODAY, d.doc), { ticker: 'ACME', strike: 55, type: 'call', expiry: '2026-12-18' });
    // the heading, the expiry control, the toggles, the column headings,
    // the list, the nav and the page are not rows
    for (const el of [d.h1, d.expiring, d.button, d.control, d.side, d.type, d.columns, d.footer, d.list, d.chain, d.nav, d.page]) {
      assert.equal(findRow(el, CHAIN_TODAY, d.doc), null);
      assert.equal(findContract(el, CHAIN_TODAY, d.doc), null);
    }
  }

  // the heading decides the ticker and the type: a put page, a sell page,
  // a dotted ticker; the toggles' Buy, Sell, Call and Put never count
  {
    const first = (opts) => fakeChainDom(opts).rows[0].strikeText;
    assert.equal(findContract(first({ heading: 'ACME buy Put' }), CHAIN_TODAY).type, 'put');
    assert.equal(findContract(first({ heading: 'ACME sell Call' }), CHAIN_TODAY).type, 'call');
    assert.deepEqual(findContract(first({ heading: 'ACME sell Put' }), CHAIN_TODAY), { ticker: 'ACME', strike: 50, type: 'put', expiry: '2026-12-18' });
    assert.deepEqual(findContract(first({ heading: 'BRK.B Buy Call' }), CHAIN_TODAY), { ticker: 'BRK.B', strike: 50, type: 'call', expiry: '2026-12-18' });
    assert.equal(toOsiSymbol(findContract(first({ heading: 'BRK.B sell put' }), CHAIN_TODAY)), 'BRKB261218P00050000');
    // no such heading: the Builder view, a lowercase ticker, a bare ticker, a plural
    assert.equal(findRow(first({ heading: 'Builder' }), CHAIN_TODAY), null);
    assert.equal(findRow(first({ heading: 'acme buy Call' }), CHAIN_TODAY), null);
    assert.equal(findRow(first({ heading: 'ACME' }), CHAIN_TODAY), null);
    assert.equal(findRow(first({ heading: 'ACME buy Calls' }), CHAIN_TODAY), null);
  }

  // the expiry control: today, tomorrow, a written year, a numeric date, a
  // token that corrects the year, a control without its testid (the first
  // Expiring phrase in the text), and no expiry at all
  {
    const expiry = (opts, today) => findContract(fakeChainDom(opts).rows[0].strikeText, today || CHAIN_TODAY).expiry;
    assert.equal(expiry({}), '2026-12-18');
    assert.equal(expiry({ expiring: 'Expiring today (0d)' }), '2026-09-05');
    assert.equal(expiry({ expiring: 'Expiring today' }), '2026-09-05');
    assert.equal(expiry({ expiring: 'Expiring tomorrow (1d)' }), '2026-09-06');
    assert.equal(expiry({ expiring: 'Expiring Tomorrow' }), '2026-09-06');
    assert.equal(expiry({ expiring: 'Expiring tomorrow (1d)' }, '2026-09-30'), '2026-10-01');
    assert.equal(expiry({ expiring: 'Expiring tomorrow (1d)' }, '2026-12-31'), '2027-01-01');
    assert.equal(expiry({ expiring: 'Expiring today (0d)' }, new Date(2026, 8, 5)), '2026-09-05');
    assert.equal(expiry({ expiring: 'Expiring December 18, 2026 (104d)' }), '2026-12-18');
    assert.equal(expiry({ expiring: 'Expiring Dec 18' }), '2026-12-18');
    assert.equal(expiry({ expiring: 'Expiring 12/18 (104d)' }), '2026-12-18');
    assert.equal(expiry({ expiring: 'Expiring Jan 15 (497d)' }), '2028-01-15');
    assert.equal(expiry({ expiring: 'Expiring Jan 15' }), '2027-01-15');
    assert.equal(expiry({ expiring: 'Expiring January 15, 2027 (497d)' }), '2027-01-15');
    assert.equal(expiry({ control: false }), '2026-12-18');
    assert.equal(expiry({ control: false, expiring: 'Expiring today (0d)' }), '2026-09-05');
    assert.equal(findRow(fakeChainDom({ expiring: 'Select expiration' }).rows[0].strikeText, CHAIN_TODAY), null);
    assert.equal(findRow(fakeChainDom({ expiring: 'Expiring soon' }).rows[0].strikeText, CHAIN_TODAY), null);
    assert.equal(findRow(fakeChainDom({ expiring: 'Expiring Feb 30' }).rows[0].strikeText, CHAIN_TODAY), null);
    assert.equal(findRow(fakeChainDom({ control: false, expiring: 'Expiring soon' }).rows[0].priceText, CHAIN_TODAY), null);
  }

  // the strike: from the testid, above 1000; a blank or malformed testid
  // falls back to the strike cell's text, and a cell that is no amount
  // either is nothing
  {
    const d = fakeChainDom({ ids: ['1250.00', '', 'x'] });
    assert.equal(toOsiSymbol(findContract(d.rows[0].strikeText, CHAIN_TODAY)), 'ACME261218C01250000');
    assert.equal(findContract(d.rows[1].priceText, CHAIN_TODAY).strike, 52.5);
    assert.equal(findRow(d.rows[1].priceText, CHAIN_TODAY).el, d.rows[1].row);
    assert.equal(findContract(d.rows[2].priceText, CHAIN_TODAY).strike, 55);
    const none = fakeChainDom({ ids: ['x', '0.00', '-5'], cells: [['Strike', '', '', '', '', '$0.18'], [['', '', '', '', '', ''][0], '', '', '', '', ''], ['n/a', '', '', '', '', '']] });
    assert.equal(findRow(none.rows[0].priceText, CHAIN_TODAY), null);
    assert.equal(findRow(none.rows[1].strikeText, CHAIN_TODAY), null);
    assert.equal(findRow(none.rows[2].strikeText, CHAIN_TODAY), null);
    assert.equal(findContract(none.rows[0].strikeText, CHAIN_TODAY), null);
  }

  // armed: hovering a cell frames the row, not the cell or the wrapper;
  // clicking the price button opens the strike's flow page, Robinhood's
  // order button never sees the click, and the picker stands down
  {
    const d = fakeChainDom();
    armPicker(d.doc, d.win);
    withClock(CHAIN_TODAY, () => {
      d.dispatch('mouseover', fakeEvent(d.rows[0].strikeText));
      assert.equal(overlaysOf(d).length, 1);
      const overlay = overlaysOf(d)[0];
      const r = d.rows[0].row.rect;
      assert.equal(overlay.style.left, (r.left - 2) + 'px');
      assert.equal(overlay.style.top, (r.top - 2) + 'px');
      assert.equal(overlay.style.width, (r.width + 4) + 'px');
      assert.equal(overlay.style.height, (r.height + 4) + 'px');
      assert.deepEqual(d.rows[0].row.style, {});
      assert.deepEqual(d.rows[0].strikeText.style, {});
      d.dispatch('mouseover', fakeEvent(d.rows[0].priceText));
      assert.equal(overlaysOf(d).length, 1);
      assert.equal(overlaysOf(d)[0], overlay);
      d.dispatch('mouseover', fakeEvent(d.rows[1].metrics[2]));
      assert.equal(overlaysOf(d)[0], overlay);
      assert.equal(overlay.style.top, (d.rows[1].row.rect.top - 2) + 'px');
      d.dispatch('mouseover', fakeEvent(d.h1));
      assert.equal(overlaysOf(d).length, 0);
      d.dispatch('mouseover', fakeEvent(d.button));
      assert.equal(overlaysOf(d).length, 0);
      d.dispatch('mouseover', fakeEvent(d.columns));
      assert.equal(overlaysOf(d).length, 0);
      d.dispatch('mouseover', fakeEvent(d.rows[0].button));
      assert.equal(overlaysOf(d).length, 1);
      const ev = fakeEvent(d.rows[0].button);
      d.dispatch('click', ev);
      assert.equal(ev.prevented, true);
      assert.equal(ev.stopped, true);
    });
    assert.deepEqual(d.calls.open, [ACME_URL]);
    assert.deepEqual(d.calls.assign, []);
    assert.deepEqual(d.calls.alert, []);
    assert.equal(overlaysOf(d).length, 0);
    assert.equal(d.children.length, 0);
    assert.equal(d.listeners.length, 0);
    assert.equal(d.winListeners.length, 0);
    assert.equal(d.win.__rhToUw, null);

    // a click on the heading alerts and opens nothing
    const other = fakeChainDom();
    armPicker(other.doc, other.win);
    other.dispatch('click', fakeEvent(other.h1));
    assert.deepEqual(other.calls.alert, [NO_CONTRACT_TEXT]);
    assert.deepEqual(other.calls.open, []);
    assert.equal(other.listeners.length, 0);
  }

  // Classic, Legend and the detail page read as before
  {
    assert.deepEqual(findRow(fakeClassicDom().acme.nameSpan, TODAY).contract, ACME);
    assert.deepEqual(findRow(fakeLegendDom().zork.cells.MARKET_VALUE, LEGEND_TODAY).contract, ZORK);
    const detail = fakeDetailDom({ card: true });
    assert.equal(findRow(detail.h1, TODAY, detail.doc).el, detail.header);
  }

  // the squeezed build resolves chain rows the same way
  {
    const api = new Function(stripModule(readFileSync(MODULE_PATH, 'utf8')) + '\nreturn { findContract, findRow, parseRobinhoodOption };')();
    const d = fakeChainDom();
    assert.deepEqual(api.findContract(d.rows[0].priceText, CHAIN_TODAY, d.doc), ACME);
    assert.equal(api.findRow(d.rows[1].strikeText, CHAIN_TODAY, d.doc).el, d.rows[1].row);
    assert.equal(api.findContract(fakeChainDom({ heading: 'ACME sell Put' }).rows[2].priceText, CHAIN_TODAY).type, 'put');
    assert.equal(api.findContract(fakeChainDom({ expiring: 'Expiring tomorrow (1d)' }).rows[0].button, CHAIN_TODAY).expiry, '2026-09-06');
    assert.equal(api.findRow(d.h1, CHAIN_TODAY, d.doc), null);
    assert.equal(api.parseRobinhoodOption('XYZ $100 Call\nJan 15 (497d)', LEGEND_TODAY).expiry, '2028-01-15');
  }
});

test('detail-page', () => {
  // the fixture: the h1 carries the head with no expiry; the expiry sits
  // under the "Expiration date" label and in the History heading, beside
  // dates that are not expiries
  {
    const text = fixtureText('rh-option-detail-page.html');
    assert.ok(text.includes('ACME $50 Call\nLegend chart'), text);
    assert.ok(text.includes('Expiration date\n12/18'), text);
    assert.ok(text.includes('Date bought\n1/2'), text);
    assert.ok(text.includes('Buy ACME $50 Call 12/18\nJan 2'), text);
    assert.ok(text.includes('Submitted\n1/2, 10:44 AM PDT'), text);
    assert.equal(countContracts(text), 2);
    assert.equal(parseRobinhoodOption('ACME $50 Call', TODAY), null);
    // the page is not a row, but the header inside it resolves through the page's text
    const d = fakeEnv();
    const h1 = fakeEl({ text: 'ACME $50 Call' });
    const page = fakeEl({ text, children: [h1] });
    assert.equal(findRow(page, TODAY, d.doc), null);
    assert.deepEqual(findContract(h1, TODAY, d.doc), ACME);
    assert.equal(findRow(h1, TODAY, d.doc).el, h1);
  }

  // the labeled "Expiration date" value: from the h1, the link and its text
  // the contract is ACME and the target is the header block, not the top
  // line or the page; the other contract's History row lends nothing
  {
    const d = fakeDetailDom({ card: true, history: 'other', title: 'ACME $50 Call | Robinhood' });
    for (const start of [d.h1, d.linkText, d.link, d.header]) {
      const hit = findRow(start, TODAY, d.doc);
      assert.ok(hit, 'header found from every part of the block');
      assert.deepEqual(hit.contract, ACME);
      assert.equal(hit.el, d.header);
      assert.notEqual(hit.el, d.top);
      assert.notEqual(hit.el, d.page);
    }
    assert.deepEqual(findContract(d.h1, TODAY, d.doc), ACME);
    // the position card, the History row, the nav and the page are not rows
    assert.equal(findRow(d.label, TODAY, d.doc), null);
    assert.equal(findRow(d.value, TODAY, d.doc), null);
    assert.equal(findRow(d.position, TODAY, d.doc), null);
    assert.equal(findRow(d.h3, TODAY, d.doc), null);
    assert.equal(findRow(d.order, TODAY, d.doc), null);
    assert.equal(findRow(d.nav, TODAY, d.doc), null);
    assert.equal(findRow(d.page, TODAY, d.doc), null);
  }

  // no such card: a History row naming the same contract in full
  {
    const d = fakeDetailDom({ history: 'same' });
    assert.deepEqual(findContract(d.h1, TODAY, d.doc), ACME);
    assert.equal(findRow(d.h1, TODAY, d.doc).el, d.header);
    const bought = fakeDetailDom({ card: 'dateless', history: 'same' });
    assert.deepEqual(findContract(bought.h1, TODAY, bought.doc), ACME);
  }

  // neither: the document title
  {
    const d = fakeDetailDom({ title: 'ACME $50 Call 12/18 | Robinhood' });
    assert.deepEqual(findContract(d.h1, TODAY, d.doc), ACME);
    assert.equal(findRow(d.h1, TODAY, d.doc).el, d.header);
    const year = fakeDetailDom({ card: 'dateless', history: 'other', title: 'ACME $50 Call 12/18/26 | Robinhood' });
    assert.deepEqual(findContract(year.h1, TODAY, year.doc), ACME);
    const words = fakeDetailDom({ title: 'ACME $50 Call Dec 18 | Robinhood' });
    assert.deepEqual(findContract(words.h1, TODAY, words.doc), ACME);
  }

  // only the date bought, a different contract's History row and a dateless
  // title: nothing, from every part of the header
  {
    const d = fakeDetailDom({ card: 'dateless', history: 'other', title: 'ACME $50 Call | Robinhood' });
    assert.equal(findContract(d.h1, TODAY, d.doc), null);
    assert.equal(findRow(d.h1, TODAY, d.doc), null);
    assert.equal(findRow(d.linkText, TODAY, d.doc), null);
    assert.equal(findRow(d.header, TODAY, d.doc), null);
    const bare = fakeDetailDom({});
    assert.equal(findContract(bare.h1, TODAY, bare.doc), null);
    assert.equal(findContract(bare.h1, TODAY, undefined), null);
    assert.equal(findContract(bare.h1, TODAY, {}), null);
  }

  // armed: hovering the header frames the header block; clicking the h1
  // opens the ACME flow page and stands the picker down
  {
    const d = fakeDetailDom({ card: true, history: 'same' });
    armPicker(d.doc, d.win);
    withClock(TODAY, () => {
      d.dispatch('mouseover', fakeEvent(d.h1));
      assert.equal(overlaysOf(d).length, 1);
      const overlay = overlaysOf(d)[0];
      const r = d.header.rect;
      assert.equal(overlay.style.left, (r.left - 2) + 'px');
      assert.equal(overlay.style.top, (r.top - 2) + 'px');
      assert.equal(overlay.style.width, (r.width + 4) + 'px');
      assert.equal(overlay.style.height, (r.height + 4) + 'px');
      assert.deepEqual(d.h1.style, {});
      assert.deepEqual(d.header.style, {});
      d.dispatch('mouseover', fakeEvent(d.linkText));
      assert.equal(overlaysOf(d).length, 1);
      assert.equal(overlaysOf(d)[0], overlay);
      d.dispatch('mouseover', fakeEvent(d.value));
      assert.equal(overlaysOf(d).length, 0);
      d.dispatch('mouseover', fakeEvent(d.h3));
      assert.equal(overlaysOf(d).length, 0);
      d.dispatch('mouseover', fakeEvent(d.h1));
      assert.equal(overlaysOf(d).length, 1);
      const ev = fakeEvent(d.h1);
      d.dispatch('click', ev);
      assert.equal(ev.prevented, true);
    });
    assert.deepEqual(d.calls.open, [ACME_URL]);
    assert.deepEqual(d.calls.assign, []);
    assert.deepEqual(d.calls.alert, []);
    assert.equal(overlaysOf(d).length, 0);
    assert.equal(d.children.length, 0);
    assert.equal(d.listeners.length, 0);
    assert.equal(d.winListeners.length, 0);
    assert.equal(d.win.__rhToUw, null);

    // a page that names no expiry: no frame, an alert, no navigation
    const none = fakeDetailDom({ card: 'dateless', history: 'other', title: 'ACME $50 Call | Robinhood' });
    armPicker(none.doc, none.win);
    none.dispatch('mouseover', fakeEvent(none.h1));
    assert.equal(overlaysOf(none).length, 0);
    none.dispatch('click', fakeEvent(none.h1));
    assert.deepEqual(none.calls.alert, [NO_CONTRACT_TEXT]);
    assert.deepEqual(none.calls.open, []);
    assert.deepEqual(none.calls.assign, []);
    assert.equal(none.listeners.length, 0);
  }

  // the squeezed build resolves the header the same way
  {
    const api = new Function(stripModule(readFileSync(MODULE_PATH, 'utf8')) + '\nreturn { findContract, findRow };')();
    const d = fakeDetailDom({ card: true });
    assert.deepEqual(api.findContract(d.h1, TODAY, d.doc), ACME);
    assert.equal(api.findRow(d.h1, TODAY, d.doc).el, d.header);
    const none = fakeDetailDom({ card: 'dateless', history: 'other' });
    assert.equal(api.findContract(none.h1, TODAY, none.doc), null);
  }
});

test('hover-highlight', () => {
  assert.equal(UW_BLUE, '#52A3CF');
  assert.equal(HIGHLIGHT_WIDTH, 2);
  assert.deepEqual(highlightRect({ left: 10, top: 20, width: 100, height: 40 }), { left: 8, top: 18, width: 104, height: 44 });

  // hover an option row: one fixed, click-through overlay framed in the
  // wordmark blue, 2px outside the row on every side, and the row untouched
  {
    const d = fakeLegendDom();
    const state = armPicker(d.doc, d.win);
    assert.equal(overlaysOf(d).length, 0);
    const hover = d.listeners.filter((l) => l.type === 'mouseover');
    const scroll = d.listeners.filter((l) => l.type === 'scroll');
    assert.equal(hover.length, 1);
    assert.equal(hover[0].capture, true);
    assert.equal(scroll.length, 1);
    assert.equal(scroll[0].capture, true);
    assert.equal(d.winListeners.filter((l) => l.type === 'resize').length, 1);

    d.dispatch('mouseover', fakeEvent(d.zork.nameSpan));
    const overlays = overlaysOf(d);
    assert.equal(overlays.length, 1);
    const overlay = overlays[0];
    assert.equal(d.children.length, 2, 'banner and overlay');
    assert.match(overlay.attributes.style, /position:fixed/);
    assert.match(overlay.attributes.style, /pointer-events:none/);
    assert.match(overlay.attributes.style, /border:2px solid #52A3CF/);
    assert.match(overlay.attributes.style, /box-sizing:border-box/);
    const r = d.zork.row.rect;
    assert.equal(overlay.style.left, (r.left - 2) + 'px');
    assert.equal(overlay.style.top, (r.top - 2) + 'px');
    assert.equal(overlay.style.width, (r.width + 4) + 'px');
    assert.equal(overlay.style.height, (r.height + 4) + 'px');
    assert.deepEqual(d.zork.row.style, {});
    assert.deepEqual(d.zork.nameSpan.style, {});
    assert.deepEqual(d.zork.nameCell.style, {});

    // staying on the same row changes nothing
    d.dispatch('mouseover', fakeEvent(d.zork.cells.MARKET_VALUE));
    assert.equal(overlaysOf(d).length, 1);
    assert.equal(overlaysOf(d)[0], overlay);

    // a stock row removes it
    d.dispatch('mouseover', fakeEvent(d.stock.nameSpan));
    assert.equal(overlaysOf(d).length, 0);
    assert.equal(d.children.length, 1, 'banner only');

    // blank page space keeps it away
    d.dispatch('mouseover', fakeEvent(d.page));
    assert.equal(overlaysOf(d).length, 0);

    // a second option row moves the same single overlay
    d.dispatch('mouseover', fakeEvent(d.zork.valueText.DAYS_TO_EXPIRATION));
    assert.equal(overlaysOf(d).length, 1);
    d.dispatch('mouseover', fakeEvent(d.spy.nameSpan));
    assert.equal(overlaysOf(d).length, 1);
    assert.equal(overlaysOf(d)[0], overlay);
    assert.equal(overlay.style.top, (d.spy.row.rect.top - 2) + 'px');

    // scroll and resize reposition from the row's new rect
    d.spy.row.rect.top = 110;
    d.dispatch('scroll', {});
    assert.equal(overlay.style.top, '108px');
    d.spy.row.rect.left = 20;
    d.dispatchWin('resize', {});
    assert.equal(overlay.style.left, '18px');
    assert.deepEqual(d.spy.row.style, {});

    // click: overlay gone, all hover listeners gone, the contract opens
    const ev = fakeEvent(d.spy.valueText.MARKET_VALUE);
    d.dispatch('click', ev);
    assert.equal(ev.prevented, true);
    assert.equal(overlaysOf(d).length, 0);
    assert.equal(d.children.length, 0);
    assert.equal(hoverListeners(d), 0);
    assert.equal(d.listeners.length, 0);
    assert.equal(d.winListeners.length, 0);
    assert.deepEqual(d.calls.open, [buildUnusualWhalesUrl(toOsiSymbol(parseRobinhoodOption(d.spy.row.innerText)))]);
    assert.deepEqual(d.calls.alert, []);
    assert.equal(d.win.__rhToUw, null);
    // cleanup twice is harmless and a stale scroll does nothing
    state.cleanup();
    d.dispatch('scroll', {});
    assert.equal(overlaysOf(d).length, 0);
  }

  // Esc removes the overlay and every listener
  {
    const d = fakeLegendDom();
    armPicker(d.doc, d.win);
    d.dispatch('mouseover', fakeEvent(d.zork.cells.QUANTITY));
    assert.equal(overlaysOf(d).length, 1);
    d.dispatch('keydown', fakeEvent(d.zork.row, 'Escape'));
    assert.equal(overlaysOf(d).length, 0);
    assert.equal(d.children.length, 0);
    assert.equal(hoverListeners(d), 0);
    assert.equal(d.listeners.length, 0);
    assert.equal(d.winListeners.length, 0);
  }

  // re-arming tears the first overlay down; at most one overlay ever exists
  {
    const d = fakeLegendDom();
    armPicker(d.doc, d.win);
    d.dispatch('mouseover', fakeEvent(d.zork.nameSpan));
    const first = overlaysOf(d)[0];
    assert.ok(first);
    const second = armPicker(d.doc, d.win);
    assert.equal(overlaysOf(d).length, 0);
    assert.equal(d.children.length, 1, 'only the new banner');
    assert.equal(hoverListeners(d), 3);
    d.dispatch('mouseover', fakeEvent(d.zork.nameSpan));
    assert.equal(overlaysOf(d).length, 1);
    assert.notEqual(overlaysOf(d)[0], first);
    second.cleanup();
    assert.equal(overlaysOf(d).length, 0);
    assert.equal(hoverListeners(d), 0);
  }

  // Classic rows get the same frame around the whole row
  {
    const d = fakeClassicDom();
    armPicker(d.doc, d.win);
    d.dispatch('mouseover', fakeEvent(d.acme.valueSpans[0]));
    assert.equal(overlaysOf(d).length, 1);
    const overlay = overlaysOf(d)[0];
    const r = d.acme.row.rect;
    assert.equal(overlay.style.left, (r.left - 2) + 'px');
    assert.equal(overlay.style.top, (r.top - 2) + 'px');
    assert.equal(overlay.style.width, (r.width + 4) + 'px');
    assert.equal(overlay.style.height, (r.height + 4) + 'px');
    assert.deepEqual(d.acme.row.style, {});
    assert.deepEqual(d.acme.left.style, {});
    d.dispatch('mouseover', fakeEvent(d.stock.valueSpans[0]));
    assert.equal(overlaysOf(d).length, 0);
    d.dispatch('mouseover', fakeEvent(d.heading));
    assert.equal(overlaysOf(d).length, 0);
    d.dispatch('keydown', fakeEvent(d.page, 'Escape'));
    assert.equal(d.children.length, 0);
  }

  // a row that cannot give a rect gets no overlay and throws nothing
  {
    const d = fakeDom(ROW_TEXT);
    armPicker(d.doc, d.win);
    d.dispatch('mouseover', fakeEvent(d.cell));
    assert.equal(overlaysOf(d).length, 0);
    assert.equal(d.children.length, 1);
    d.dispatch('scroll', {});
    d.dispatch('keydown', fakeEvent(d.row, 'Escape'));
    assert.equal(d.children.length, 0);
  }
});

// --- no-network: the built bookmarklet talks to nothing but Unusual Whales --

// Names that become traps on globalThis and on the fake window: a getter that
// records the name and throws, so the bookmarklet cannot reach the API by
// either path without failing the test.
const POISONED_GLOBALS = ['fetch', 'XMLHttpRequest', 'XDomainRequest', 'WebSocket', 'EventSource', 'Image', 'Worker', 'SharedWorker', 'RTCPeerConnection', 'indexedDB', 'localStorage', 'sessionStorage', 'caches'];

function poison(target, prop, label, log) {
  Object.defineProperty(target, prop, {
    configurable: true,
    enumerable: false,
    get() {
      log.push(label);
      throw new Error('the bookmarklet touched ' + label);
    },
    set() {
      log.push(label);
      throw new Error('the bookmarklet assigned ' + label);
    },
  });
}

// Runs fn with the fake DOM d installed as the global document, window and
// navigator and every poisoned name in place, then restores each global from
// the own-property descriptor snapshotted beforehand (names Node never had
// are deleted again). Returns the labels the bookmarklet touched. The fake
// window also gains recorders for every other way a page can navigate, and
// the fake document records the tag of every element it creates. Whatever
// fn did, throw or return, the page must be left without listeners.
function withPoisonedGlobals(d, fn) {
  const log = [];
  const names = POISONED_GLOBALS.concat(['navigator', 'document', 'window']);
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const navigator = {};
  for (const prop of ['sendBeacon', 'serviceWorker', 'clipboard']) {
    poison(navigator, prop, 'navigator.' + prop, log);
  }
  for (const name of POISONED_GLOBALS) {
    poison(d.win, name, 'window.' + name, log);
  }
  poison(d.doc, 'cookie', 'document.cookie', log);
  d.win.navigator = navigator;
  d.win.postMessage = function () {
    log.push('window.postMessage');
    throw new Error('the bookmarklet called window.postMessage');
  };
  d.calls.href = [];
  d.calls.replace = [];
  d.calls.targets = [];
  d.calls.handles = [];
  Object.defineProperty(d.win.location, 'href', {
    configurable: true,
    get() { return ''; },
    set(value) { d.calls.href.push(value); },
  });
  d.win.location.replace = (value) => { d.calls.replace.push(value); };
  const realOpen = d.win.open;
  d.win.open = function (url, target) {
    d.calls.targets.push(target);
    const handle = realOpen.call(d.win, url);
    if (handle) {
      d.calls.handles.push(handle);
    }
    return handle;
  };
  const realCreate = d.doc.createElement;
  d.created = [];
  d.doc.createElement = function (tag) {
    d.created.push(String(tag).toLowerCase());
    return realCreate.call(d.doc, tag);
  };
  let failure = null;
  try {
    for (const name of POISONED_GLOBALS) {
      poison(globalThis, name, name, log);
    }
    Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: navigator });
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: d.doc });
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: d.win });
    fn(log);
  } catch (e) {
    failure = e;
  } finally {
    for (const [name, desc] of saved) {
      if (desc) {
        Object.defineProperty(globalThis, name, desc);
      } else {
        delete globalThis[name];
      }
    }
  }
  const leftover = d.listeners.length + d.winListeners.length;
  if (failure) {
    if (leftover) {
      failure.message += ' (' + leftover + ' listener(s) left behind)';
    }
    throw failure;
  }
  assert.equal(leftover, 0, 'listeners left behind');
  return log;
}

// Pins the clock the bookmarklet reads through new Date(), so the expiry
// year it infers, and with it the OSI symbol, cannot drift with the calendar.
function withClock(iso, fn) {
  const RealDate = Date;
  const fixed = new RealDate(iso + 'T12:00:00').getTime();
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }

    static now() {
      return fixed;
    }
  }
  globalThis.Date = FixedDate;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

// The committed bookmarklet, decoded and run the way a browser runs it: a
// plain script in the global scope whose main() arms the picker.
function runBookmarklet() {
  new Function(decodeBookmarklet(readFileSync(OUTPUT_PATH, 'utf8').trim()))();
}

// After a click under the harness: no trap touched, exactly one window.open
// to the flow page for osi with nothing else in the URL, no other navigation,
// nothing but divs created, and the picker fully stood down.
function assertOnlyOpened(d, log, osi) {
  assert.deepEqual(log, [], 'poisoned globals touched');
  assert.equal(d.calls.open.length, 1, 'window.open calls');
  const opened = new URL(d.calls.open[0]);
  assert.equal(opened.origin, 'https://unusualwhales.com');
  assert.equal(opened.pathname, '/flow/option_chains');
  assert.deepEqual([...opened.searchParams], [['chain', osi], ['days', '1'], ['mins', '5']]);
  assert.equal(opened.hash, '');
  assert.equal(opened.username, '');
  assert.deepEqual(d.calls.targets, ['_blank']);
  assert.deepEqual(d.calls.alert, []);
  assert.deepEqual(d.calls.href, []);
  assert.deepEqual(d.calls.replace, []);
  assert.deepEqual(d.created, ['div', 'div'], 'banner and overlay only');
  assert.equal(d.children.length, 0);
  assert.equal(d.listeners.length, 0);
  assert.equal(d.winListeners.length, 0);
  assert.equal(d.win.__rhToUw, null);
  return d.calls.open[0];
}

test('no-network-static', () => {
  const stripped = stripModule(readFileSync(MODULE_PATH, 'utf8'));
  const built = decodeBookmarklet(readFileSync(OUTPUT_PATH, 'utf8').trim());
  assert.ok(stripped.length > 5000 && built.length > 5000, 'both texts are the whole program');
  assert.equal(UW_BASE, 'https://unusualwhales.com/flow/option_chains');
  for (const [name, text] of [['module', stripped], ['bookmarklet', built]]) {
    for (const token of FORBIDDEN_TOKENS) {
      assert.ok(!text.includes(token), name + ' contains ' + JSON.stringify(token));
    }
    const urls = text.match(SCHEME_URL_RE) || [];
    assert.ok(urls.length >= 1, name + ' names the flow page');
    for (const url of urls) {
      assert.equal(url, UW_BASE, name + ' URL literal');
    }
    assert.deepEqual([...new Set(text.match(HOSTNAME_RE))], ['unusualwhales.com'], name + ' hostname literals');
  }

  // the scan bites: each rule catches a planted violation
  assert.ok(FORBIDDEN_TOKENS.some((t) => (stripped + "navigator.sendBeacon('/x')").includes(t)));
  assert.ok(FORBIDDEN_TOKENS.some((t) => (built + "a.style.background='url(x.png)'").includes(t)));
  assert.deepEqual((stripped + " fetch('https://evil.net/x')").match(SCHEME_URL_RE), [UW_BASE, 'https://evil.net/x']);
  assert.deepEqual([...new Set((built + ' "//cdn.example.com/a.js"').match(HOSTNAME_RE))], ['unusualwhales.com', 'cdn.example.com']);
  assert.deepEqual('row.contract || hit.constructor'.match(HOSTNAME_RE), null);
});

test('no-network-classic', () => {
  // the traps are live and the harness leaves no trace of itself
  {
    const d = fakeDom(ROW_TEXT);
    const log = withPoisonedGlobals(d, () => {
      assert.throws(() => fetch('/x'), /touched fetch/);
      assert.throws(() => new Image(), /touched Image/);
      assert.throws(() => navigator.sendBeacon('/x'), /navigator.sendBeacon/);
      assert.throws(() => document.cookie, /document.cookie/);
      assert.throws(() => window.WebSocket, /window.WebSocket/);
      assert.throws(() => window.postMessage('x', '*'), /postMessage/);
      assert.equal(document, d.doc);
      assert.equal(window, d.win);
    });
    assert.deepEqual(log, ['fetch', 'Image', 'navigator.sendBeacon', 'document.cookie', 'window.WebSocket', 'window.postMessage']);
    assert.equal(typeof globalThis.document, 'undefined');
    assert.equal(typeof globalThis.window, 'undefined');
    assert.equal(typeof globalThis.Image, 'undefined');
    assert.equal(typeof fetch, 'function');
  }

  // arm, hover the ACME row, scroll, resize, click it
  const RealDate = Date;
  const d = fakeClassicDom();
  const log = withPoisonedGlobals(d, () => withClock(TODAY, () => {
    runBookmarklet();
    assert.equal(d.children.length, 1, 'armed: the banner is up');
    assert.equal(d.children[0].textContent, BANNER_TEXT);
    d.dispatch('mouseover', fakeEvent(d.acme.nameSpan));
    assert.equal(overlaysOf(d).length, 1, 'the row is framed');
    d.dispatch('scroll', {});
    d.dispatchWin('resize', {});
    d.dispatch('click', fakeEvent(d.acme.valueSpans[0]));
  }));
  const url = assertOnlyOpened(d, log, 'ACME261218C00050000');
  assert.equal(url, ACME_URL);
  assert.equal(d.calls.handles.length, 1);
  assert.equal(d.calls.handles[0].opener, null, 'the opener link is dropped');
  assert.deepEqual(d.calls.assign, []);
  assert.equal(Date, RealDate, 'the clock is real again');
  assert.equal(typeof globalThis.document, 'undefined');
});

test('no-network-legend', () => {
  // arm, hover the ZORK row, scroll, click its market-value cell: new tab
  {
    const d = fakeLegendDom();
    const log = withPoisonedGlobals(d, () => withClock(LEGEND_TODAY, () => {
      runBookmarklet();
      d.dispatch('mouseover', fakeEvent(d.zork.nameSpan));
      assert.equal(overlaysOf(d).length, 1, 'the row is framed');
      d.dispatch('scroll', {});
      d.dispatch('click', fakeEvent(d.zork.cells.MARKET_VALUE));
    }));
    const url = assertOnlyOpened(d, log, 'ZORK261016C00075000');
    assert.equal(url, ZORK_URL);
    assert.equal(d.calls.handles.length, 1);
    assert.equal(d.calls.handles[0].opener, null, 'the opener link is dropped');
    assert.deepEqual(d.calls.assign, []);
  }

  // popup blocked: the same URL goes to location.assign once, nothing else moves
  {
    const d = fakeLegendDom();
    d.win.popupBlocked = true;
    const log = withPoisonedGlobals(d, () => withClock(LEGEND_TODAY, () => {
      runBookmarklet();
      d.dispatch('mouseover', fakeEvent(d.zork.valueText.DAYS_TO_EXPIRATION));
      d.dispatch('scroll', {});
      d.dispatch('click', fakeEvent(d.zork.nameSpan));
    }));
    const url = assertOnlyOpened(d, log, 'ZORK261016C00075000');
    assert.equal(url, ZORK_URL);
    assert.deepEqual(d.calls.handles, []);
    assert.deepEqual(d.calls.assign, [url]);
  }
});
