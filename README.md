# Redside 🎣

A personal Central Oregon fishing companion — a phone app (PWA) that tells you
**where to fish, what to fish for, and what to use.** Built for a beginner, and
built to work at the lake **with no cell signal.**

Same idea as Cadence: no App Store, no download. You open it in Safari and tap
**Add to Home Screen**, and after that it opens full-screen with its own icon.

## What's in it

- **Today** — a live "where to fish" ranking of your 7 waters, each with a *bite
  score* (0–100) that blends the season with current river flow and weather, plus
  a plain-English reason for the score. A drive-time filter defaults to *within 45
  min of Madras* ("after-work") and opens up to *anywhere*.
- **Waters** — the seven spots: Haystack, Lake Billy Chinook, Lower Deschutes,
  Middle Deschutes, Crane Prairie, Wickiup, and East Lake. Each has a full guide:
  when it's good, what to fish for, exactly how (beginner-level), what gear to
  bring, where to get on the water, local quirks, and a **rules panel** that links
  to the official ODFW page (the app never states a bag limit as gospel — Oregon's
  rules change too often to trust a hard-coded number).
- **Ask** — describe your day ("couple hours after work, close") and get a pick.
  Works offline via the rules engine; if you deploy the optional AI endpoint, it
  layers a richer written answer on top.
- **Log** — your catch log. Stored **only on your phone**. Log what you caught,
  where, and what worked; each entry also snapshots the conditions at the time. A
  season in, this becomes your own cheat sheet. Export/import JSON to move it to a
  new phone.
- Tap any <u>underlined term</u> (kokanee, wedding ring, nymph…) for a one-line
  plain-English definition.

## Live data (free, no keys)

- **River flow + water temp** — USGS Water Services (Lower Deschutes gauge
  `14092500`, Middle Deschutes `14076500`, Crooked/Billy Chinook inflow `14087400`).
- **Weather** — Open-Meteo.
- **This week's bite + stocking** — links out to the ODFW Central Zone report.

Both APIs are fetched in the browser and cached to `localStorage`, so the last
sync is always available offline. The app re-syncs whenever you open it online.

## Run it locally

It's plain static files — no build step. From this folder:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

(Any static server works. A service worker needs `http://localhost` or HTTPS —
opening `index.html` from the file system won't register it.)

## Deploy it (so you can install it on your phone)

You need it on an HTTPS URL. Easiest options:

**Cloudflare Pages** (recommended — the optional AI function "just works" here):
1. Push this folder to a GitHub repo.
2. Cloudflare dashboard → Pages → connect the repo. Build command: *none*.
   Output directory: `/` (root).
3. Done — you get a `*.pages.dev` URL.

**Azure Static Web Apps** (fits your Microsoft stack):
1. Create a Static Web App pointed at the repo; app location `/`, no build.
2. For the AI endpoint, move `functions/api/advisor.js` into an Azure Functions
   app (`/api`) — same fetch logic, Azure handler signature — and set
   `ANTHROPIC_API_KEY` in the app's configuration.

## Install on your iPhone

1. Open the deployed URL in **Safari** (must be Safari for install).
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Launch it from the new icon — it opens full-screen, no browser chrome, and
   works offline.

To share with a buddy, just send them the URL; they do the same three taps.

## Optional: turn on the AI advisor

The app is fully functional without this. To enable free-form "Ask" answers:

1. Deploy on Cloudflare Pages (the `functions/api/advisor.js` route is picked up
   automatically and serves `POST /api/advisor`).
2. In Pages → Settings → Environment variables, add a **secret**
   `ANTHROPIC_API_KEY` with your Anthropic key.
3. That's it. If the endpoint isn't there, the app silently falls back to the
   rules engine, so nothing breaks.

The key lives only on the server — it's never shipped to the phone.

## The knowledge base

Everything about the fish lives in **`js/data.js`** — one object per water,
following a fixed shape (intro, season, per-species how/gear/when, access, local
knowledge, rules notes, and a 12-month "bite curve" that drives the score). That
file is the asset. To add a water or refine advice, copy an existing block and
edit it; the rest of the app picks it up automatically.

## Files

```
index.html                 app shell + bottom tab bar
styles.css                 the Redside design system
js/data.js                 the 7-water knowledge base  ← the content
js/conditions.js           USGS flow + Open-Meteo weather, with offline cache
js/advisor.js              bite-score rules engine (+ optional AI hook)
js/log.js                  local catch log with export/import
js/app.js                  router + all views
sw.js                      service worker (offline)
manifest.webmanifest       install metadata
icons/                     app icons
functions/api/advisor.js   optional serverless AI endpoint
```

## A word on the rules

Oregon fishing regulations change — emergency closures, per-water exceptions,
tribal-permit water (the Metolius arm of Billy Chinook). This app points you at
the official ODFW pages and reminds you to check them. **It is a planning aid, not
the rulebook.** When in doubt, read the current regs before you keep a fish.
