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

Everything is stored in `localStorage` on each device (key `mindless-spending-v1`). Phone and computer do not sync: use *Ajustes → Descargar copia / Cargar copia* to move data or keep a backup.

Shape: `{v:1, settings:{currency}, cats:[{id,name,emoji,type:'exp'|'inc',budget}], tx:[{id,type:'exp'|'inc'|'save',amount,cat,date,note,goalId?,fixedId?,forMonth?}], fixed:[{id,kind:'bill'|'sub'|'inc',name,amount,cat,day,start,end,used?}], goals:[{id,name,emoji,target,deadline}]}`.

- A fixed item is due every month from `start` to `end` (`end === start` means one-off). Marking it paid creates a movement with `fixedId` + `forMonth`.
- "Te queda" = income − expenses − savings − unpaid fixed bills of the month.

## How updates reach the app

The service worker fetches files from the network first and only falls back to the cache when offline, so any change pushed to the site is picked up the next time the app opens with a connection. Bump `VERSION` in `app.js` to show the "La app se actualizó" notice; if you change `sw.js` itself, bump `CACHE` too.

## Hosting

GitHub Pages: repository Settings → Pages → Deploy from a branch → `main` / root.
