import { NextResponse } from "next/server";

/**
 * Optional LLM enhancement endpoint for the natural-language what-if box.
 *
 * - GET  -> reports whether an LLM key is configured (UI badge).
 * - POST -> if OPENAI_API_KEY is set, asks the model to phrase the impact
 *           explanation; otherwise returns { enabled: false } and the client
 *           falls back to the deterministic local explanation.
 *
 * The simulation itself NEVER depends on the LLM — it always runs locally.
 */
export async function GET() {
  return NextResponse.json({ enabled: Boolean(process.env.OPENAI_API_KEY) });
}

export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ enabled: false });

  try {
    const { command, context } = await req.json();
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "You are RailMind, a railway operations control assistant. Given a what-if command and the simulated network impact JSON, explain in 2-3 crisp sentences the operational impact and the recommended response. Be concrete and use the numbers provided."
          },
          {
            role: "user",
            content: `Command: ${command}\nSimulated impact: ${JSON.stringify(context)}`
          }
        ]
      })
    });
    if (!res.ok) return NextResponse.json({ enabled: false });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    return NextResponse.json({ enabled: true, text });
  } catch {
    return NextResponse.json({ enabled: false });
  }
}
