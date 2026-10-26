import { AI_KEY, getSetting } from "./settings";

export type CorrectResult = { text: string } | { error: "notConfigured" | "failed" };

/** Asks the AI (set up in Setup → AI) to fix spelling and grammar, in the person's own language. */
export async function correctWithAi(text: string, locale: string): Promise<CorrectResult> {
  try {
    // Local development keeps its AI settings in the browser, so it sends them along; the live server uses its own.
    const ai = import.meta.env.PROD ? undefined : await getSetting(AI_KEY).then((raw) => (raw ? JSON.parse(raw) : undefined)).catch(() => undefined);
    const res = await fetch("/api/billing-files", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "correct", text, language: locale === "en" ? "en" : "fr", ai }),
    });
    const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
    if (data.text) return { text: data.text };
    return { error: data.error === "ai.notConfigured" ? "notConfigured" : "failed" };
  } catch {
    return { error: "failed" };
  }
}
