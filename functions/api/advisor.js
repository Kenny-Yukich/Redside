// functions/api/advisor.js
// OPTIONAL AI layer. The app works fully without this — the rules engine handles
// recommendations offline. Deploy this only if you want free-form "ask" answers.
//
// This is a Cloudflare Pages Function: a file here at functions/api/advisor.js
// automatically serves POST /api/advisor. It keeps your Anthropic API key on the
// server so it's never exposed in the app. Set ANTHROPIC_API_KEY as an
// environment variable / secret in your Cloudflare Pages project settings.
//
// (Azure Static Web Apps? The same logic drops into an HTTP-triggered function;
//  see the README. The only differences are the handler signature and where the
//  key comes from.)

export async function onRequestPost({ request, env }) {
  try {
    const { question, date, context } = await request.json();

    const system =
      "You are a friendly Central Oregon fishing guide talking to a BEGINNER who " +
      "knows almost nothing about fishing. Recommend where to go and what to do in " +
      "plain, encouraging language. Keep it to 3-5 sentences. Explain any jargon in " +
      "a few words. Base your answer ONLY on the provided water data and current " +
      "conditions — do not invent regulations, and remind them to check official " +
      "ODFW rules if keeping fish. Prefer the highest-scoring waters unless the " +
      "person's question points elsewhere.";

    const userMsg =
      `Today: ${date}\n\nAngler's question: ${question}\n\n` +
      `Waters (ranked, with live conditions):\n${JSON.stringify(context, null, 2)}`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5", // swap to a haiku model to cut cost further
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return json({ error: "upstream", detail }, 502);
    }
    const data = await res.json();
    const answer = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return json({ answer });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
