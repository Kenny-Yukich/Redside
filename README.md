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
- **Fish This Spot** — take or choose a photo, confirm its position and facing
  on satellite imagery, then get three targets drawn on the clean photo. Pick
  species and your saved tackle, answer any clarification, and inspect the
  labeled grid and raw JSON in Debug. Plans and photos are stored in IndexedDB
  for offline use. **Tried it** records fish, bites, or nothing in the catch log.
- **Settings** — open from Fish This Spot to save your Worker URL, app passphrase,
  public Mapbox token, and **My Tackle** list on this device.
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

The front end stays on **GitHub Pages**, with no build command. In the repository,
open **Settings → Pages**, publish the branch's root folder, and confirm its URL.
For `Kenny-Yukich/Redside`, the expected URL is
`https://kenny-yukich.github.io/Redside/`. The `github.com` repository URL is not
the app's browser origin. The old `ktrainusa503` address is not used here.

AI requests go to a separate Cloudflare Worker. From this repository root:

```powershell
cd worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put MAPBOX_TOKEN
npx wrangler secret put APP_PASSPHRASE
```

Wrangler prompts for each secret. Enter the resulting Worker URL and matching
app passphrase in Redside **Fish Spot → Settings**. Add a separate public Mapbox
token restricted to your Pages URL for the interactive map. Keep the provider
keys in Worker secrets. See [the Worker deployment guide](worker/README.md) for
token scopes, CORS, local development, and the iPhone acceptance checklist.

## Install on your iPhone

1. Open the deployed URL in **Safari** (must be Safari for install).
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Launch it from the new icon — it opens full-screen, no browser chrome, and
   works offline.

To share with a buddy, just send them the URL; they do the same three taps.

## Optional: turn on the AI advisor

The same Worker serves `POST /api/advisor` for **Ask**. Once configured in
Settings, Ask uses it for richer answers and continues to use the existing
offline rules engine as its fallback. The unused Pages Function has been removed.

## Photos, offline plans, and privacy

- GPS comes from the device or the pin you place. Photo EXIF GPS is never read.
  Native browser image decoding handles orientation; canvas copies remove photo
  metadata before upload. Images are resized to at most 1568 px on the long edge
  and encoded as JPEG at quality 0.8. Only the labeled copy is sent for analysis.
- Landscape grids are A–F / 1–4; portrait grids are A–D / 1–6. The displayed
  photo stays clean, with circles at cell centers. Satellite imagery can be old;
  the model must distinguish visible evidence from guesses about depth, fish,
  current level, and old shorelines.
- Queued photos and completed plans persist in IndexedDB. Reconnect with Redside
  open, or reopen it, to resume the queue. iOS can suspend closed apps, so this
  does not depend on background sync. Saved plans work without map tiles.
  An interrupted request already in flight asks you to retry, since it may have
  completed on the server. A failed PNG save keeps the result and rebuilds the
  share image locally without buying another analysis.
- The service worker does not cache POSTs or Worker responses. It caches the
  app shell and the Leaflet library after use; satellite tiles need signal.
- Share prepares a PNG for the native share sheet, with download as a fallback.
  Water name and coordinates are excluded unless you enable the share toggle.
- **Tried it** saves the plan ID, zone, tackle, outcome, note, and condition
  snapshot in the existing catch log. JSON catch backups preserve those fields.
  Bites and nothing are displayed in the log but do not increase the caught
  statistic. Catch backups do **not** include plan photos; export a PNG to keep
  a separate photo copy. Clearing site data removes local settings and plans.

## Check the feature

No front-end build or npm dependencies are required. With Node 22 or newer:

```powershell
node --test --test-isolation=none worker/worker.test.mjs tests/spot-media.test.mjs
```

Browser checks use Playwright as a development-only dependency; see
[tests/README.md](tests/README.md). Upstream responses are mocked in automated
tests. Actual model/map access and iPhone Safari installed to the home screen
still need the on-device checklist in [worker/README.md](worker/README.md).

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
js/spot*.js               photo UI, map, device settings, queue, IndexedDB, media
worker/                   authenticated Cloudflare Worker + deployment guide
tests/                    image and browser checks
```

## A word on the rules

Oregon fishing regulations change — emergency closures, per-water exceptions,
tribal-permit water (the Metolius arm of Billy Chinook). This app points you at
the official ODFW pages and reminds you to check them. **It is a planning aid, not
the rulebook.** When in doubt, read the current regs before you keep a fish.
