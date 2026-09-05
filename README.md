# rh-to-uw

Jump easily from an option in Robinhood to its Unusual Whales contract lookup
page.

1. Click the bookmarklet.
2. Click any option in your Robinhood portfolio.
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
contract. Esc cancels. Clicking anything that is not an option row shows a
short message and stands down.

## How it picks the contract

It reads the row's text, not Robinhood's markup. From `ACME $50 Call`
expiring `12/18` it builds the OSI symbol `ACME261218C00050000` (ticker,
expiry as YYMMDD, C or P, strike times 1000) and opens
`https://unusualwhales.com/flow/option_chains?chain=ACME261218C00050000&days=1&mins=5`.
An expiry with no year means the next time that date comes around, and
Legend's days-to-expiration column confirms the year when it is shown.

## Limits

- Robinhood's web app only, Classic or Legend. Not the mobile app.
- Spreads shown as one row resolve to their first leg.
- Adjusted or weekly index roots such as `SPY1` or `SPXW` pass through as
  written and will not match on Unusual Whales.
- The row must say Call or Put.

## Privacy

The whole program is the bookmark itself. It loads nothing, stores nothing,
and sends nothing anywhere. The only thing that leaves the page is the
Unusual Whales URL it opens for you.
