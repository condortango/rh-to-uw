# rh-to-uw

Jump easily from an option in Robinhood to its Unusual Whales contract lookup
page.

1. Click the bookmarklet.
2. Click any option in your Robinhood portfolio, the header of an option's
   own page, or a row of an option chain.
3. Unusual Whales opens in a new tab, already on that contract.

## Install

Everything is on one page: <https://condortango.github.io/rh-to-uw/>

Drag it:

1. Open the page.
2. Drag the "RH to UW" link onto your bookmarks bar.

Or paste it:

1. Open the page and copy the text in the box under the link.
2. Add a bookmark and paste that text as its URL.
3. If the bookmark does nothing, put `javascript:` back at the front. Some
   browsers strip it on paste.

## Use

Open your positions on robinhood.com, Classic or Legend, and click the
bookmark. A banner appears at the top and a blue frame follows the option row
under the mouse. Click a row and Unusual Whales opens in a new tab on that
contract. Esc cancels. On an option's own page, the one with the chart and
your position, the frame sits on the header and clicking it opens that
contract. On an option chain, the page with a row per strike, every row
lights up and clicking one opens that strike without starting an order.
Clicking anything that is not an option row shows a short message and
stands down.

## How it picks the contract

It reads the row's text, not Robinhood's markup. From `ACME $50 Call`
expiring `12/18` it builds the OSI symbol `ACME261218C00050000` (ticker,
expiry as YYMMDD, C or P, strike times 1000) and opens
`https://unusualwhales.com/flow/option_chains?chain=ACME261218C00050000&days=1&mins=5`.
An expiry with no year means the next time that date comes around, and
Legend's days-to-expiration column confirms the year when it is shown.

An option's own page shows its header as `ACME $50 Call` without the
expiry. There the bookmarklet reads the expiry from the Expiration date in
your position, from a history entry naming the same contract in full, or
from the tab title, never from the date bought or an order time. Dates
written as `Dec 18` or `December 18, 2026` are read as well as `12/18`.

A row of an option chain is only a strike. There the bookmarklet takes the
ticker and Call or Put from the `ACME buy Call` heading above the chain,
the expiry from the `Expiring December 18 (104d)` control, and the strike
from the row. A `sell Put` chain gives puts; the Buy/Sell and Call/Put
buttons themselves are never read.

## Limits

- Robinhood's web app only, Classic or Legend. Not the mobile app.
- On an option chain, the single-leg view only. Not the Builder.
- Spreads shown as one row resolve to their first leg.
- Adjusted or weekly index roots such as `SPY1` or `SPXW` pass through as
  written and will not match on Unusual Whales.
- The row must say Call or Put.
- On an option's own page the expiry must be shown in your position, in its
  history, or in the tab title. A contract you have never held or traded may
  show none of them, and then nothing opens.

## Privacy

The whole program is the bookmark itself. It loads nothing, stores nothing,
and sends nothing anywhere. The only thing that leaves the page is the
Unusual Whales URL it opens for you.

## Source

The readable program is `src/rh-to-uw/rh-to-uw.mjs`. The build script,
`src/rh-to-uw/build.mjs`, strips it down, wraps it in a function call and
percent-encodes it into `src/rh-to-uw/rh-to-uw.bookmarklet.txt`, then writes
`docs/index.html`, the install page, around that same link. The tests in
`src/rh-to-uw/rh-to-uw.test.mjs` rebuild the module and compare the result
with the text file and the page, so the published source and the published
link cannot drift apart. The HTML files in `src/rh-to-uw/fixtures/` are
samples of each Robinhood layout, with made-up positions.

## Development

Node 20 or newer, no dependencies.

```
node --test src/rh-to-uw/rh-to-uw.test.mjs
node src/rh-to-uw/build.mjs
```

The text file and `docs/index.html` must both match a fresh build, and the
link must stay under 32,768 bytes. The `build-output` test checks all of it.
The other tests run the module and the built link against a hand-rolled fake
DOM built from the fixtures.
