// rh-to-uw.mjs
// Robinhood (Classic, Legend, an option's detail page or the option chain)
// -> Unusual Whales option-chain bookmarklet.
//
// The pure helpers are exported for node:test. build.mjs strips the export
// keywords, drops the auto-run guard between the strip markers, wraps the
// rest in an IIFE that ends with main(), and percent-encodes the result.
// Keep this file free of imports, template literals, trailing comments, and
// regex literals that contain quote characters: build.mjs relies on that.

export const UW_BASE = 'https://unusualwhales.com/flow/option_chains';
export const MAX_WALK = 8;
export const BANNER_TEXT = 'Click an option position (Esc to cancel)';
export const NO_CONTRACT_TEXT = 'No option contract found in what you clicked';
// The "Whales" wordmark blue of the Unusual Whales logo.
export const UW_BLUE = '#52A3CF';
// Width in px of the frame drawn just outside the option row under the mouse.
export const HIGHLIGHT_WIDTH = 2;

// "<TICKER> [M/D[/YY]] $<strike> Call|Put". Legend writes the expiry between
// the ticker and the strike; Classic writes it after the type (EXPIRY_RE).
// Either way the strike is the number directly before the type, so other
// amounts in the row can never be mistaken for it.
const HEAD_RE = /(?:^|[^A-Za-z.])([A-Z]{1,6}(?:\.[A-Z])?)\s+(?:(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\s+)?\$?(\d[\d,]*(?:\.\d+)?)\s+([Cc][Aa][Ll][Ll]|[Pp][Uu][Tt])(?![A-Za-z])/;
// Classic: "M/D", "M/D/YY" or "M/D/YYYY" anywhere after the type.
const EXPIRY_RE = /(?:^|\D)(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?!\d)/;
// A date by month name: "Dec 18", "December 18, 2026", "Sept. 18". A word
// such as "Expires" or "Exp." in front is just what precedes the match.
const EXPIRY_WORDS_RE = /(?:^|[^A-Za-z])(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?(?![\d\/])/i;
const MONTHS = 'janfebmaraprmayjunjulaugsepoctnovdec';
// The option detail page: "Expiration date" over the date, in the position
// card. The group is the rest of the value's line.
const EXPIRY_LABEL_RE = /Expiration date\s*([^\n]*)/i;
// A days-to-expiration token: Legend's standalone "41D", or "(104d)" in
// parentheses as the option chain's expiry control writes it.
const DTE_RE = /(?:^|\s)(\d{1,4})D(?![A-Za-z0-9])|\((\d{1,4})[Dd]\)/;
const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})/;
const OSI_RE = /^[A-Z0-9]{1,6}\d{6}[CP]\d{8}$/;
const TICKER_RE = /^[A-Za-z][A-Za-z.]{0,7}$/;
// Legend grid cells carry data-cell-id="optionLeg-<leg key>_POSITION_COLUMN_NAME_<column>".
const LEGEND_CELL_PREFIX = 'optionLeg-';
const LEGEND_KEY_SEP = '_POSITION_COLUMN_NAME_';
const GRID_ROLES = ['rowgroup', 'grid', 'table', 'treegrid'];
// The option chain page: one row per strike, its data-testid
// "ChainTableRow-<strike>"; above the rows, a "<TICKER> buy|sell Call|Put"
// heading and an expiry control whose button reads "Expiring <Month> <D>
// (<n>d)", "Expiring today" or "Expiring tomorrow".
const CHAIN_ROW_PREFIX = 'ChainTableRow-';
const CHAIN_EXPIRY_TESTID = 'SelectExpirationDateDropdown';
const CHAIN_HEAD_RE = /^\s*([A-Z]{1,6}(?:\.[A-Z])?)\s+(?:[Bb]uy|[Ss]ell)\s+([Cc]all|[Pp]ut)\b/m;
const EXPIRING_RE = /Expiring\s+(today|tomorrow|[^\n]+)/i;
// The amount a chain row's text opens with: its strike cell.
const STRIKE_RE = /^\s*\$?(\d[\d,]*(?:\.\d+)?)/;
const MS_PER_DAY = 86400000;
// A days-to-expiration token further than this from every candidate year is noise.
const DTE_TOLERANCE = 183;

function pad(n, width) {
  return String(n).padStart(width, '0');
}

// Accepts a Date (local calendar) or a YYYY-MM-DD string.
function dateParts(value) {
  if (typeof value === 'string') {
    const m = ISO_RE.exec(value);
    if (m) {
      return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
    }
    value = new Date(value);
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('expected a Date or a YYYY-MM-DD string');
  }
  return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
}

function isValidDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1) {
    return false;
  }
  return d <= new Date(y, m, 0).getDate();
}

function isoDate(y, m, d) {
  return pad(y, 4) + '-' + pad(m, 2) + '-' + pad(d, 2);
}

// A month/day with no year means the next time that date comes around:
// this year when it is today or later, otherwise next year.
export function inferYear(month, day, today) {
  const t = dateParts(today);
  return month * 100 + day >= t.m * 100 + t.d ? t.y : t.y + 1;
}

// Legend shows how many days are left ("41D"). When the expiry carried no
// year, pick whichever of the inferred year, the one before and the one
// after puts the expiry closest to that many days from today. When even the
// best candidate is more than half a year off, the token is treated as
// noise and the inferred year stands.
function yearFromDte(month, day, inferred, dte, today) {
  const t = dateParts(today);
  const origin = Date.UTC(t.y, t.m - 1, t.d);
  let best = inferred;
  let bestGap = Infinity;
  for (let y = inferred - 1; y <= inferred + 1; y++) {
    if (!isValidDate(y, month, day)) {
      continue;
    }
    const days = Math.round((Date.UTC(y, month - 1, day) - origin) / MS_PER_DAY);
    const gap = Math.abs(days - dte);
    if (gap < bestGap) {
      best = y;
      bestGap = gap;
    }
  }
  return bestGap <= DTE_TOLERANCE ? best : inferred;
}

// A month and day with the year as written, else inferred and corrected by
// a days-to-expiration token in text: YYYY-MM-DD, or null for no such day.
function resolveDate(month, day, yearText, text, today) {
  let year;
  if (yearText === undefined) {
    year = inferYear(month, day, today);
    const dte = DTE_RE.exec(text);
    if (dte) {
      year = yearFromDte(month, day, year, Number(dte[1] || dte[2]), today);
    }
  } else if (yearText.length === 2) {
    year = 2000 + Number(yearText);
  } else {
    year = Number(yearText);
  }
  return isValidDate(year, month, day) ? isoDate(year, month, day) : null;
}

// The first date in text, numeric or by month name, whichever comes first,
// as YYYY-MM-DD; null when there is none.
function parseExpiry(text, today) {
  const num = EXPIRY_RE.exec(text);
  const words = EXPIRY_WORDS_RE.exec(text);
  const m = num && (!words || num.index <= words.index) ? num : words;
  return m ? resolveDate(m === num ? Number(m[1]) : MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) / 3 + 1, Number(m[2]), m[3], text, today) : null;
}

// The option chain's expiry control: "Expiring today", "Expiring tomorrow"
// or "Expiring <Month> <D>[, <YYYY>] (<n>d)", as YYYY-MM-DD; null when the
// text holds no such phrase.
function parseExpiring(text, today) {
  const m = EXPIRING_RE.exec(text);
  if (!m) {
    return null;
  }
  const word = m[1].toLowerCase();
  if (word !== 'today' && word !== 'tomorrow') {
    return parseExpiry(m[1], today);
  }
  const t = dateParts(today);
  const d = dateParts(new Date(t.y, t.m - 1, t.d + (word === 'tomorrow' ? 1 : 0)));
  return isoDate(d.y, d.m, d.d);
}

// Reads a Robinhood option row's text, Classic or Legend; the text decides
// which. Returns {ticker, strike, type, expiry} or null when the text is not
// an option row or names no expiry. With headOnly set, a "<TICKER> $<strike>
// Call|Put" head that names no expiry still comes back, with expiry null:
// that is how the option detail page's header is read.
export function parseRobinhoodOption(text, today = new Date(), headOnly) {
  const m = typeof text === 'string' ? HEAD_RE.exec(text) : null;
  if (!m) {
    return null;
  }
  const strike = Number(m[5].replace(/,/g, ''));
  if (!Number.isFinite(strike) || strike <= 0) {
    return null;
  }
  const expiry = m[2] !== undefined ? resolveDate(Number(m[2]), Number(m[3]), m[4], text, today) : parseExpiry(text.slice(m.index + m[0].length), today);
  return expiry || headOnly ? { ticker: m[1], strike: strike, type: m[6].toLowerCase(), expiry: expiry } : null;
}

// How many "<TICKER> $<strike> Call|Put" heads the text holds.
export function countContracts(text) {
  if (typeof text !== 'string') {
    return 0;
  }
  const re = new RegExp(HEAD_RE.source, 'g');
  let n = 0;
  while (re.exec(text)) {
    n += 1;
  }
  return n;
}

function typeCode(type) {
  const t = String(type).toLowerCase();
  if (t === 'call' || t === 'c') {
    return 'C';
  }
  if (t === 'put' || t === 'p') {
    return 'P';
  }
  throw new TypeError('type must be call or put');
}

// OSI symbol: root with dots removed, YYMMDD, C or P, strike x 1000 in 8 digits.
export function toOsiSymbol(contract) {
  const c = contract || {};
  if (typeof c.ticker !== 'string' || !TICKER_RE.test(c.ticker)) {
    throw new TypeError('ticker must be a short letter string');
  }
  const strike = Number(c.strike);
  if (!Number.isFinite(strike) || strike <= 0) {
    throw new TypeError('strike must be a positive number');
  }
  const e = dateParts(c.expiry);
  const root = c.ticker.toUpperCase().replace(/\./g, '');
  return root + pad(e.y % 100, 2) + pad(e.m, 2) + pad(e.d, 2) + typeCode(c.type) + pad(Math.round(strike * 1000), 8);
}

export function buildUnusualWhalesUrl(osi) {
  if (typeof osi !== 'string' || !OSI_RE.test(osi)) {
    throw new TypeError('expected an OSI option symbol');
  }
  return UW_BASE + '?chain=' + encodeURIComponent(osi) + '&days=1&mins=5';
}

function textOf(el) {
  const text = typeof el.innerText === 'string' ? el.innerText : el.textContent;
  return typeof text === 'string' ? text : '';
}

function attrOf(el, name) {
  return el && typeof el.getAttribute === 'function' ? el.getAttribute(name) : null;
}

// The element's viewport rect, or null when the node cannot give one.
function rectOf(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') {
    return null;
  }
  const r = el.getBoundingClientRect();
  if (!r || typeof r.left !== 'number' || typeof r.top !== 'number' || typeof r.width !== 'number' || typeof r.height !== 'number') {
    return null;
  }
  return r;
}

function sameHead(a, b) {
  return a.ticker === b.ticker && a.strike === b.strike && a.type === b.type;
}

function sameContract(a, b) {
  return sameHead(a, b) && a.expiry === b.expiry;
}

// True when the text opens with the contract head, so a list, section or
// page whose text merely contains an option row somewhere is not taken for
// the row itself.
function leadsWithContract(text) {
  const m = HEAD_RE.exec(text);
  if (!m) {
    return false;
  }
  return text.slice(0, m.index + m[0].indexOf(m[1])).trim() === '';
}

// Two elements share a vertical band when their rects overlap by at least
// half the shorter one. Unknown rects count as sharing.
function sameBand(a, b) {
  const ra = rectOf(a);
  const rb = rectOf(b);
  if (!ra || !rb) {
    return true;
  }
  const overlap = Math.min(ra.top + ra.height, rb.top + rb.height) - Math.max(ra.top, rb.top);
  return overlap >= Math.min(ra.height, rb.height) / 2;
}

// el is the innermost element whose text parses and child is the one of its
// children that holds the start node. When another child of el carries the
// contract on its own, the start node is only inside the row if both sit in
// the same vertical band: a value cell beside the name does, a stock row
// above or below the option row does not.
function startInsideRow(el, child, contract, today) {
  if (!child) {
    return true;
  }
  const kids = el.children || [];
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i];
    if (kid === child) {
      continue;
    }
    const found = parseRobinhoodOption(textOf(kid), today);
    if (found && sameContract(found, contract)) {
      return sameBand(child, kid);
    }
  }
  return true;
}

// True when every data-cell-id below el starts with key.
function cellsShareKey(el, key) {
  const kids = el.children || [];
  for (let i = 0; i < kids.length; i++) {
    const id = attrOf(kids[i], 'data-cell-id');
    if (typeof id === 'string' && id.indexOf(key) !== 0) {
      return false;
    }
    if (!cellsShareKey(kids[i], key)) {
      return false;
    }
  }
  return true;
}

function isGridContainer(el) {
  const role = attrOf(el, 'role');
  return typeof role === 'string' && GRID_ROLES.indexOf(role.trim().toLowerCase()) >= 0;
}

// The first element below el whose data-testid is id, else null.
function findTestId(el, id) {
  const kids = el.children || [];
  for (let i = 0; i < kids.length; i++) {
    const found = attrOf(kids[i], 'data-testid') === id ? kids[i] : findTestId(kids[i], id);
    if (found) {
      return found;
    }
  }
  return null;
}

// The option chain page. The row is the nearest ancestor whose data-testid
// starts with "ChainTableRow-" and the strike is the number after that
// prefix, else the amount the row's text opens with. Ticker and type come
// from the "<TICKER> buy|sell Call|Put" heading, never from the Buy/Sell
// and Call/Put toggles, whose state only shows in hashed class names; the
// expiry from the expiry control's button, else from the first "Expiring"
// phrase in the text. Both are read from the nearest ancestor of the row
// whose text holds that heading and yields an expiry, so the heading, the
// toggles and the control itself are never rows.
function findChainRow(start, today) {
  let row = start;
  let id = null;
  for (let i = 0; row && i <= MAX_WALK; i++) {
    const value = attrOf(row, 'data-testid');
    if (typeof value === 'string' && value.indexOf(CHAIN_ROW_PREFIX) === 0) {
      id = value;
      break;
    }
    row = row.parentElement;
  }
  if (id === null) {
    return null;
  }
  let strike = Number(id.slice(CHAIN_ROW_PREFIX.length));
  if (!(strike > 0)) {
    const cell = STRIKE_RE.exec(textOf(row));
    strike = cell ? Number(cell[1].replace(/,/g, '')) : 0;
  }
  if (!Number.isFinite(strike) || strike <= 0) {
    return null;
  }
  for (let el = row.parentElement; el; el = el.parentElement) {
    const text = textOf(el);
    const head = CHAIN_HEAD_RE.exec(text);
    if (head) {
      const control = findTestId(el, CHAIN_EXPIRY_TESTID);
      const expiry = parseExpiring(control ? textOf(control) : text, today);
      if (expiry) {
        return { el: row, contract: { ticker: head[1], strike: strike, type: head[2].toLowerCase(), expiry: expiry } };
      }
    }
  }
  return null;
}

// Legend: the cells of one option leg share a data-cell-id key. From the
// nearest such cell, climb while the parent is not the grid itself and every
// cell below it still carries that key; the last such element is the row.
function findLegendRow(start, today) {
  let cell = start;
  let id = null;
  for (let i = 0; cell && i <= MAX_WALK; i++) {
    const value = attrOf(cell, 'data-cell-id');
    if (typeof value === 'string' && value.indexOf(LEGEND_CELL_PREFIX) === 0) {
      id = value;
      break;
    }
    cell = cell.parentElement;
  }
  if (id === null) {
    return null;
  }
  const sep = id.indexOf(LEGEND_KEY_SEP);
  if (sep < 0) {
    return null;
  }
  const key = id.slice(0, sep);
  let row = cell;
  let parent = cell.parentElement;
  for (let i = 0; parent && i <= MAX_WALK; i++) {
    if (isGridContainer(parent) || !cellsShareKey(parent, key)) {
      break;
    }
    row = parent;
    parent = parent.parentElement;
  }
  const contract = parseRobinhoodOption(textOf(row), today);
  return contract ? { el: row, contract: contract } : null;
}

// An expiry for a head that came without one, read from text: the value
// under an "Expiration date" label, else the first line naming the same
// contract in full, as the History row "Buy ACME $50 Call 12/18" does. Any
// other date in the text, the date bought or an order time, never counts.
function findExpiryForHead(head, text, today) {
  const label = EXPIRY_LABEL_RE.exec(text);
  const labeled = label ? parseExpiry(label[1], today) : null;
  if (labeled) {
    return labeled;
  }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const found = parseRobinhoodOption(lines[i], today);
    if (found && sameHead(found, head)) {
      return found.expiry;
    }
  }
  return null;
}

// True when text holds exactly one head, the contract's, and either the
// contract's expiry or none at all.
function readsAs(text, contract, today) {
  const found = parseRobinhoodOption(text, today, true);
  return !!found && sameHead(found, contract) && countContracts(text) === 1 && (!found.expiry || found.expiry === contract.expiry);
}

// Classic, the option detail page and any unknown markup. The hit is the
// innermost element whose text opens with exactly one contract head and
// holds the start node in the same band as it. When that text also names
// the expiry, as a Classic row does, that is the contract. When it does
// not, as the detail page's header does, the walk goes on while the parent
// still reads as just that head (a Classic name cell finds its expiry in
// the row this way); failing that, the expiry comes from the text of the
// ancestor MAX_WALK levels up, or the topmost one, with the document title
// as its last line (findExpiryForHead). Then up from the hit while the
// parent still reads as that one contract and is at most 1.5 times as
// tall, which keeps the position list out even when it holds a single
// option and keeps the frame on the header block, never the page.
function findGenericRow(start, today, doc) {
  let el = start;
  let child = null;
  let hit = null;
  let hitChild = null;
  let contract = null;
  for (let i = 0; el && i <= MAX_WALK; i++) {
    const text = textOf(el);
    const found = parseRobinhoodOption(text, today, true);
    if (found && countContracts(text) === 1 && leadsWithContract(text)) {
      if (!contract || found.expiry) {
        contract = found;
        hit = el;
        hitChild = child;
      }
      if (found.expiry) {
        break;
      }
    } else if (found || contract) {
      break;
    }
    child = el;
    el = el.parentElement;
  }
  if (contract && !contract.expiry) {
    let top = hit;
    for (let i = 0; i < MAX_WALK && top.parentElement; i++) {
      top = top.parentElement;
    }
    contract.expiry = findExpiryForHead(contract, textOf(top) + '\n' + ((doc && doc.title) || ''), today);
  }
  if (!contract || !contract.expiry || !startInsideRow(hit, hitChild, contract, today)) {
    return null;
  }
  const rect = rectOf(hit);
  const maxHeight = rect ? rect.height * 1.5 : 0;
  let row = hit;
  let parent = hit.parentElement;
  for (let i = 0; parent && i <= MAX_WALK; i++) {
    const r = rectOf(parent);
    if (!readsAs(textOf(parent), contract, today) || !r || r.height > maxHeight) {
      break;
    }
    row = parent;
    parent = parent.parentElement;
  }
  return { el: row, contract: contract };
}

// The row element to frame and the contract it carries, or null. Option
// chain rows are found by their data-testid, Legend rows by their shared
// data-cell-id key, everything else by text; doc lends its title when the
// text names no expiry.
export function findRow(start, today = new Date(), doc = globalThis.document) {
  const el = start && start.nodeType === 1 ? start : (start && start.parentElement) || null;
  if (!el) {
    return null;
  }
  return findChainRow(el, today) || findLegendRow(el, today) || findGenericRow(el, today, doc);
}

export function findContract(start, today = new Date(), doc) {
  const row = findRow(start, today, doc);
  return row ? row.contract : null;
}

// Where the hover frame goes for a row's rect: HIGHLIGHT_WIDTH px outside the
// row on every side, so the frame never covers the row itself.
export function highlightRect(rect) {
  const w = HIGHLIGHT_WIDTH;
  return { left: rect.left - w, top: rect.top - w, width: rect.width + 2 * w, height: rect.height + 2 * w };
}

// window.open with a "noopener" feature returns null by spec, which would
// make a popup-blocked fallback fire on every click, so open plainly and
// drop the opener link by hand.
export function openInNewTab(win, url) {
  const opened = win.open(url, '_blank');
  if (opened) {
    try {
      opened.opener = null;
    } catch (e) {
      // a cross-origin handle may refuse; the tab is open either way
    }
    return 'tab';
  }
  win.location.assign(url);
  return 'same-tab';
}

// One-shot picker: the next click anywhere is captured, Robinhood never sees
// it, and the clicked row's contract opens on Unusual Whales. Esc cancels.
// The banner is a fixed pill framed in the Unusual Whales blue; being fixed
// and centred by a transform, its border never moves the page content.
// While armed, the option row under the mouse is framed by a fixed overlay
// that never touches the row's own style. Arming again replaces the previous
// arm instead of stacking listeners.
export function armPicker(doc = globalThis.document, win = globalThis.window) {
  if (!doc || !win || !doc.body) {
    throw new Error('armPicker needs a document with a body and a window');
  }
  const prev = win.__rhToUw;
  if (prev && typeof prev.cleanup === 'function') {
    prev.cleanup();
  }
  const body = doc.body;
  const banner = doc.createElement('div');
  banner.textContent = BANNER_TEXT;
  banner.setAttribute('style', 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border-radius:6px;background:#111;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none;border:2px solid ' + UW_BLUE + ';');
  body.appendChild(banner);
  const overlay = doc.createElement('div');
  overlay.setAttribute('data-rh-to-uw', 'highlight');
  overlay.setAttribute('style', 'position:fixed;left:0;top:0;width:0;height:0;margin:0;padding:0;box-sizing:border-box;border:' + HIGHLIGHT_WIDTH + 'px solid ' + UW_BLUE + ';border-radius:4px;background:transparent;pointer-events:none;z-index:2147483646;');
  const prevCursor = body.style.cursor;
  body.style.cursor = 'crosshair';
  let active = true;
  let current = null;
  let frame = 0;
  const state = { cleanup: cleanup };
  function place(rect) {
    const box = highlightRect(rect);
    overlay.style.left = box.left + 'px';
    overlay.style.top = box.top + 'px';
    overlay.style.width = box.width + 'px';
    overlay.style.height = box.height + 'px';
  }
  function hideHighlight() {
    current = null;
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }
  function showHighlight(el) {
    const rect = rectOf(el);
    if (!rect) {
      hideHighlight();
      return;
    }
    current = el;
    place(rect);
    if (!overlay.parentNode) {
      body.appendChild(overlay);
    }
  }
  function reposition() {
    frame = 0;
    if (!active || !current) {
      return;
    }
    const rect = rectOf(current);
    if (rect) {
      place(rect);
    } else {
      hideHighlight();
    }
  }
  function onMove() {
    if (!active || !current) {
      return;
    }
    if (typeof win.requestAnimationFrame === 'function') {
      if (!frame) {
        frame = win.requestAnimationFrame(reposition);
      }
      return;
    }
    reposition();
  }
  function onHover(event) {
    const row = findRow(event.target, new Date(), doc);
    if (!row) {
      hideHighlight();
      return;
    }
    if (row.el !== current) {
      hideHighlight();
      showHighlight(row.el);
    }
  }
  function cleanup() {
    if (!active) {
      return;
    }
    active = false;
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('mouseover', onHover, true);
    doc.removeEventListener('scroll', onMove, true);
    win.removeEventListener('resize', onMove);
    if (frame && typeof win.cancelAnimationFrame === 'function') {
      win.cancelAnimationFrame(frame);
    }
    frame = 0;
    hideHighlight();
    if (banner.parentNode) {
      banner.parentNode.removeChild(banner);
    }
    body.style.cursor = prevCursor;
    if (win.__rhToUw === state) {
      win.__rhToUw = null;
    }
  }
  function onKey(event) {
    if (event.key !== 'Escape' && event.key !== 'Esc') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    cleanup();
  }
  function onClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
    cleanup();
    const contract = findContract(event.target, new Date(), doc);
    if (!contract) {
      win.alert(NO_CONTRACT_TEXT);
      return;
    }
    openInNewTab(win, buildUnusualWhalesUrl(toOsiSymbol(contract)));
  }
  doc.addEventListener('click', onClick, { capture: true, once: true });
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('mouseover', onHover, true);
  doc.addEventListener('scroll', onMove, true);
  win.addEventListener('resize', onMove);
  win.__rhToUw = state;
  return state;
}

export function main() {
  return armPicker();
}

// @bookmarklet-strip-start
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  main();
}
// @bookmarklet-strip-end
