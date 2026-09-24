# Feature checks

Redside itself remains static JavaScript with no build step. These tools are only
needed to run automated checks while developing.

From the repository root, run the dependency-free tests with a current Node.js:

```sh
node --test tests/*.test.mjs
```

Install the optional browser test dependency and Chromium, then run the smoke
checks. No `package.json`, lockfile, or generated app files are required:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/browser-smoke.mjs
```

The smoke script starts and stops its own local static server. It covers image
resizing and grids, PNG privacy and download/share paths, IndexedDB persistence,
settings, context, simulated iOS compass permission, mocked analysis/questions,
offline queue recovery, catch-log export/import, queue deletion races, PNG storage
quota recovery without repeated model calls, and an
actual service-worker offline reload. Worker requests are mocked: no API keys,
passphrase, Mapbox account, or paid model calls are needed. Screenshots go in the
ignored `test-results/` directory.

An additional real-Leaflet drag check fetches the public Leaflet 1.9.4 JavaScript
and stylesheet from cdnjs, while mocking all Mapbox tiles and using a fake public
token. Enable it with `REDSIDE_TEST_LEAFLET=1`. It verifies independent pin/arrow
dragging and the full `/Redside/` tile referrer needed for URL-restricted tokens:

```powershell
$env:REDSIDE_TEST_LEAFLET = '1'
node tests/browser-smoke.mjs
```

If Playwright is installed elsewhere, set `REDSIDE_PLAYWRIGHT_MODULE` to its
`index.mjs` file. To use installed Chrome instead of the bundled browser, set
`REDSIDE_BROWSER_CHANNEL=chrome`. For example, in PowerShell:

```powershell
$env:REDSIDE_BROWSER_CHANNEL = 'chrome'
node tests/browser-smoke.mjs
```

These checks use Chromium with a phone viewport; they do not replace an iPhone
Safari/Home Screen test. On the deployed app, verify camera/library selection,
GPS permission, actual compass permission and reading, satellite pin/arrow
dragging, Share Sheet behavior, and offline resume after suspending/reopening the
installed app. A real analysis and its debug grid/JSON require deployed Worker
secrets and the public map token configured in Settings.
