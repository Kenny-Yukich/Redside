# Redside advisor Worker

The front end remains a static, vanilla-JS PWA on GitHub Pages. This Worker replaces the unused Pages Function in `functions/api/advisor.js`. It serves authenticated `POST /analyze` and the existing optional Ask Redside endpoint, `POST /api/advisor`. No front-end build step is introduced; Wrangler bundles the shared `../js/spot-contract.js` module when deploying the Worker.

## Deploy

Install a current Node.js LTS and run these commands from the repository root. Wrangler will prompt you to sign in to Cloudflare. `secret put` prompts for each value; do not paste keys into source files or command arguments.

```powershell
cd worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put MAPBOX_TOKEN
npx wrangler secret put APP_PASSPHRASE
```

The first deploy creates the Worker. It returns a configuration error until all secrets are set. Each `secret put` updates the deployed Worker. Copy the resulting `https://redside-advisor.<your-subdomain>.workers.dev` URL into Redside Settings, with no `/analyze` suffix.

- `ANTHROPIC_API_KEY`: an Anthropic API key with access to `claude-sonnet-5`. The model constant stays exactly `claude-sonnet-5`.
- `MAPBOX_TOKEN`: a separate server-side Mapbox access token with the `styles:tiles` scope. Do not add browser URL restrictions to this token: the Worker has no browser Referer. It is kept in a Worker secret, never returned to the client or sent to Claude.
- `APP_PASSPHRASE`: a strong unique passphrase. Enter the same value once in Redside Settings on each device. The client stores it on that device and sends it in `x-app-passphrase`; it is not included in saved plans, logs, or exports.

For later Worker updates, run `npx wrangler deploy` again from `worker`. Existing Wrangler secrets persist. [Cloudflare documents secret deployment and local development here.](https://developers.cloudflare.com/workers/configuration/secrets/)

## GitHub Pages origin and map token

`wrangler.toml` is configured for the expected Pages origin `https://kenny-yukich.github.io`. Confirm the actual site in the GitHub repository's **Settings → Pages**. If the site has a custom domain, replace `ALLOWED_ORIGIN` with that one origin and redeploy.

The repository page `https://github.com/Kenny-Yukich/Redside` is not the running app. For the expected Pages site `https://kenny-yukich.github.io/Redside/`, a browser sends `Origin: https://kenny-yukich.github.io` without a path. CORS can restrict that origin, not the `/Redside/` path. The Worker allows exactly one configured origin, requires the passphrase on both POST routes, and rejects missing Origins as well as other sites. Preflight OPTIONS is unauthenticated because browsers do not send the passphrase in a preflight.

Create a second, public `pk.` Mapbox token for the client map, with `styles:tiles`. In Mapbox token settings restrict its allowed URL to your actual Pages URL, expected to be `https://kenny-yukich.github.io/Redside/`. Do not use the account's default public token because it cannot have URL restrictions. Do not add a wildcard. Enter this public token in Redside Settings; keep the Worker token separate. The map tile requests send a referrer that includes the Pages path, so that restriction can match. [Mapbox explains token scopes and URL restrictions here.](https://docs.mapbox.com/accounts/guides/tokens/)

## Request and response

`POST /analyze` accepts `Content-Type: application/json` and `x-app-passphrase`. Its body is:

```js
{
  photo: "data:image/jpeg;base64,...", // client-rendered, labeled grid; no EXIF GPS read
  grid: { columns: 6, rows: 4 },      // portrait: { columns: 4, rows: 6 }
  lat: 44.49,
  lon: -121.15,
  heading: 90,                      // degrees clockwise from north, 0 <= heading < 360
  species: ["Rainbow trout"],
  tackle: ["Size 2 spinner"],
  context: {
    water: {},                      // full nearest WATERS entry, or "unknown water"
    distanceMeters: 150,             // null when unavailable; known water must be <= 2000
    biteScore: {},                   // scoreWater(water), or null
    conditions: {},                  // cachedFor(water.id), including USGS/weather timestamps, or null
    date: "2026-09-24T12:00:00.000Z"
  },
  answers: []                       // { question: "...", answer: "..." } from each clarification
}
```

The Worker fetches a north-up 1024×1024 `satellite-v9` image at zoom 17, centered on the confirmed position, with a pin and a 70-metre line in the chosen facing direction. It passes the gridded photo and the fetched satellite bytes to Claude as two labeled images. Mapbox's API supports these [GeoJSON overlays](https://docs.mapbox.com/api/maps/static-images/); Claude accepts [base64 image content blocks](https://platform.claude.com/docs/en/build-with-claude/vision).

A forced `return_spot_analysis` tool defines the JSON schema. Server and client both use `validateResult` to enforce exactly three distinct valid grid cells, numbered titles, supported evidence tags, bounded text, and exact tackle names for owned tackle. The response is directly one of:

```js
{
  kind: "plan",
  zones: [ // exactly 3, ordered by id
    {
      id: 1, cell: "B2", title: "Start here", // then Work this next / Third option
      tackle: "Size 2 spinner", fromMyTackle: true,
      aim: "Cast beside the visible rock.",
      technique: "Retrieve slowly with short pauses.",
      reasons: [{ source: "photo", text: "A rock is visible near the bank." }]
      // source: "photo", "overhead", or "Redside data"
    }
  ],
  fallback: "After ten casts, change retrieve speed.",
  visible: ["A rock is visible by the bank."],
  guesses: ["Depth, fish presence and current level are unknown."]
}
// or
{
  kind: "question",
  question: "Which way is the surface moving?",
  options: ["Left", "Right", "Not sure"]
}
```

The prompt treats old overhead imagery, changing reservoir shorelines, unknown depth, fish presence, and current levels as uncertain. Ambiguities that affect the plan produce a question instead of zones. Answering sends the same photo and context plus accumulated answers. Model interpretation can still be wrong; debug mode exposes the actual grid and validated JSON for inspection on a familiar spot.

Sonnet 5 supports the [forced tool choice](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) used here. Thinking is explicitly disabled to preserve the response budget because [Sonnet 5 enables adaptive thinking by default](https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5). The tool schema is non-strict JSON Schema with local validation, including constraints such as exact array sizes that strict tool mode does not support. Invalid or truncated output becomes a retryable error, never a partially rendered plan.

Errors are JSON `{ error: "..." }` with an HTTP error status. Request bodies are capped at 8 MiB, context and lists are bounded, and upstream error bodies are never returned or logged. All Worker responses use `Cache-Control: no-store`. The service worker ignores POST requests. There is no Worker database and no Worker photo cache; saved and queued plans live in the client's IndexedDB.

## Verification

From the repository root, with Node 24 or newer:

```powershell
node --test --test-isolation=none worker/worker.test.mjs
```

These tests mock both upstream APIs and exercise validation, CORS, authentication, body limits, photo/overhead payloads, facing geometry, questions and answers, malformed model output, the Ask compatibility route, and secret-safe error handling. They do not call paid APIs.

The no-isolation flag lets these dependency-free tests also run in sandboxes that disallow child processes. Outside such sandboxes, `node --test worker/worker.test.mjs` also works.

An actual end-to-end result requires deployed secrets, model access, and a real photo. On iPhone Safari, open the Pages app, use **Share → Add to Home Screen**, configure the Worker URL, public Mapbox token and passphrase, then:

1. Take a landscape photo at a known spot. Confirm GPS, drag the pin, allow the compass when prompted, and drag the facing arrow to verify the override.
2. Analyze with saved tackle and a species. Inspect the debug grid and raw JSON, tap all three zones, and verify the separate fallback and uncertainty sections.
3. Repeat with a portrait library photo. Set its location manually. If a clarification appears, tap an answer and confirm it produces a plan or a new useful question.
4. Save a plan, relaunch in airplane mode, and reopen it. Queue a new analysis while offline; reconnect with Redside open and confirm it runs. iOS may suspend closed PWAs: queued work resumes when the app is opened or brought to the foreground, not reliably while closed.
5. Share a PNG with location off, then explicitly enable the location toggle and share again. Log **Tried it**, export JSON, and confirm the plan link and outcome survive import.

For local Worker development, put temporary secrets in ignored `worker/.dev.vars` and run:

```powershell
cd worker
npx wrangler dev --var ALLOWED_ORIGIN:http://localhost:8080
```

Use a separate development public map token allowing `http://localhost:8080`, and set the local app's Worker URL to `http://localhost:8787`. Production stays restricted to its one Pages origin. Never commit `.dev.vars`, `.env`, or any secret.
