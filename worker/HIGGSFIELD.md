# Higgsfield integration

## Existing architecture

Redside is a vanilla-JavaScript PWA hosted as static files on GitHub Pages. Its
Cloudflare Worker currently serves the photo-analysis and optional Ask endpoints.
Both require the device-stored app passphrase and the configured Pages origin.
There are no user accounts, tenant IDs, or agent runtime. Photos/plans live in
IndexedDB; settings and catch logs live in localStorage. The browser resumes the
analysis queue while open. The Worker has no database or background job runner.

Higgsfield generation belongs on the server. An application feature needs durable
generation records and an ownership check in addition to the shared passphrase.
An agent integration instead needs a durable request checkpoint tied to the
invoking user's execution context. Neither should wait for an entire generation
inside a browser request or rely on the existing photo-analysis retry policy.

## SDK and credentials

The official JavaScript package is `@higgsfield/client`; use its `/v2` export on
the server. Dependencies are confined to `worker/`, keeping the Pages app free of
build steps. [SDK documentation](https://docs.higgsfield.ai/docs/how-to/sdk).

The reusable adapter is `higgsfield-client.js`. It uses a separate official SDK
client instance for submission, with `withPolling: false`, a request timeout, and
`maxRetries: 0`. Version 0.2.6 of the JavaScript v2 SDK does not expose methods to
resume an existing request. The adapter therefore uses a small REST fallback for
status checks, validating the returned status URL before sending credentials and
including `User-Agent: Redside/1.0 (Higgsfield generation jobs)`. Submission keeps
the SDK's own documented HTTP behavior. SDK/Axios errors are sanitized before
they leave the adapter; raw errors can contain authorization headers.

Install dependencies and run the local checks from `worker/`:

```powershell
npm ci
node --test --test-isolation=none *.test.mjs
```

This adapter does not itself create a public route, user interface, job store,
or authorization layer. Those depend on the selected application or agent use
case. Its `submit` operation must only be called after recording an owned job;
its `status` operation performs one check, leaving persistent polling/backoff to
that job layer. Do not expose either method directly to unauthenticated callers.

The JavaScript SDK's documented variable is `HF_CREDENTIALS`, containing
`KEY_ID:KEY_SECRET`. The existing root `.env` uses `HIGGSFIELD_API_KEY`; configure
that combined value as `HF_CREDENTIALS` in the server environment. Never add it to
Redside's browser settings or a public JavaScript module.

For local Wrangler development, use the ignored `worker/.dev.vars` file. The
committed `.dev.vars.example` contains placeholders only. For production, from
the `worker` directory:

```powershell
npx wrangler secret put HF_CREDENTIALS
```

Enter the combined credential at Wrangler's prompt, without putting it in the
command line. Authentication identifies the Higgsfield account; individual model
access still needs verification for that account.
[Authentication](https://docs.higgsfield.ai/docs/authentication).

## Model discovery

The live [Console Explore](https://open.higgsfield.ai/explore) catalog and
[documentation index](https://docs.higgsfield.ai/docs/llms.txt) were consulted on
2026-09-24. Catalog presence is not proof of access for a particular API key.
Model-specific documentation, rather than the general OpenAPI listing, defines
the operation and its accepted fields.

| Output | Verified endpoint | Model reference |
| --- | --- | --- |
| Image from a prompt | `higgsfield-ai/soul/v2/standard` | [SOUL V2](https://docs.higgsfield.ai/docs/models/soul-2/generate) |
| Video from a prompt | `bytedance/seedance-2.0/text-to-video` | [Seedance 2.0 text to video](https://docs.higgsfield.ai/docs/models/seedance-2/text-to-video) |
| Animate a photo | `bytedance/seedance-2.0/image-to-video` | [Seedance 2.0 image to video](https://docs.higgsfield.ai/docs/models/seedance-2/image-to-video) |

The catalog also lists Seedance 2.5. It should not silently replace a specifically
requested Seedance 2.0 operation. The photo-animation endpoint requires a public
`image_url`, does not accept an `aspect_ratio`, and derives framing from its input.
Text to video accepts `prompt`, integer `duration` from 4 through 15, `resolution`,
`aspect_ratio`, and boolean `generate_audio`. Fields must be validated against the
selected operation's schema.

The supplied Seedance 2.0 REST example translates to this SDK call. This is a
reference example, not an executed generation:

```js
import { createHiggsfieldClient } from "@higgsfield/client/v2";

const higgsfield = createHiggsfieldClient({
  credentials: process.env.HF_CREDENTIALS,
  maxRetries: 0,
  timeout: 30000,
});
const handle = await higgsfield.subscribe(
  "bytedance/seedance-2.0/text-to-video",
  {
    input: {
      prompt: "A cinematic tracking shot along a sunlit coastal road",
      resolution: "720p",
      generate_audio: true,
      duration: 5,
      aspect_ratio: "16:9",
    },
    withPolling: false,
  },
);
// Persist handle.request_id and handle.status_url in the owned job immediately.
```

## Asynchronous lifecycle

Persist a local job and ownership before submission, then persist Higgsfield's
`request_id` and returned `status_url` as soon as submission succeeds. Each local
job must have a stable submission key so duplicate clicks or browser retries do
not buy another generation. Higgsfield does not accept submission idempotency
keys: an ambiguous timeout must stay unresolved until reconciled, rather than
being automatically submitted again.
[Lifecycle](https://docs.higgsfield.ai/docs/concepts/requests),
[errors and retries](https://docs.higgsfield.ai/docs/concepts/errors).

Use bounded polling with backoff and stop on `completed`, `failed`, `nsfw`, or
`canceled`. An application timeout stops waiting; it does not prove that the
provider canceled the generation. Auth/validation failures require corrective
action. Keep transient polling retries separate from generation submissions.
[Polling](https://docs.higgsfield.ai/docs/concepts/polling),
[rate limits](https://docs.higgsfield.ai/docs/concepts/rate-limits).

Webhooks are supported through the submission's `hf_webhook` parameter. The
public guide does not document a signature-verification scheme. A future webhook
handler should treat deliveries as notifications and verify the request through
the authenticated status endpoint before trusting results; deduplicate deliveries
and retain polling as recovery.
[Webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks).

Output URLs are retained for at least seven days. Completed media needs an
explicit download or a copy to owned storage for long-term use.
[Billing and retention](https://docs.higgsfield.ai/docs/concepts/billing-and-retention).
