# Mindless Spending

Control de gastos personal. A static, installable web app: no account, no server, works offline. Spanish UI.

## What's inside

| File | Purpose |
|---|---|
| `index.html` | Page shell |
| `styles.css` | Design: white page, green brand. Red = expenses, green = income, yellow = pending/warnings. Phone and desktop layouts |
| `app.js` | All app logic: month overview, movements, fixed payments and subscriptions, analysis, savings goals, settings |
| `sw.js` | Offline support (network first, cache fallback) |
| `manifest.webmanifest`, `icons/` | Install as an app on phone and desktop |

## Data

Everything is stored in `localStorage` on each device (key `mindless-spending-v1`, data version `v: 2`; v1 data is migrated on load). Phone and computer do not sync: use *Ajustes → Descargar copia / Cargar copia* to move data or keep a backup.

Money lives in **accounts**, each with its own currency (e.g. a EUR bank and a COP savings account). Every movement keeps its original amount and currency (`acc`, `cur`, `amount`).

- Totals (month overview, categories, chart) are shown in the view currency (`settings.view`, toggled EUR/COP) and converted with `settings.rates` (units per 1 EUR), fetched daily from open.er-api.com (fallback: fawazahmed0 currency-api on jsDelivr) and cached for offline use. Rates can also be set by hand.
- Cross-currency operations store both real amounts, so the rate actually charged is kept: transfers (`type: 'transfer'`, `amount`/`cur` out, `toAmount`/`toCur` in), debt payments (`debtId`, `debtAmount` in the debt's currency), goal contributions (`goalId`, `goalAmount` in the goal's currency).
- Fixed items (`fixed`) have their own currency and the account they are paid from; marking one paid converts it to the account currency (editable afterwards) and, if linked to a debt, lowers it.
- Category budgets are in the main currency.
- "Te queda" = income − expenses − savings − unpaid fixed bills of the month.

## How updates reach the app

The service worker fetches files from the network first and only falls back to the cache when offline, so any change pushed to the site is picked up the next time the app opens with a connection. Bump `VERSION` in `app.js` to show the "La app se actualizó" notice; if you change `sw.js` itself, bump `CACHE` too.

## Hosting

GitHub Pages: repository Settings → Pages → Deploy from a branch → `main` / root.
