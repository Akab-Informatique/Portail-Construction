/**
 * Reads an uploaded quote or invoice (PDF or image) with an AI model and returns the figures on it.
 * Providers: Google Gemini (has a free API tier) or Anthropic Claude.
 * The result is only a suggestion: staff always review it before anything is published.
 */

export type Extracted = {
  number?: string;
  title?: string;
  client_name?: string;
  issued_on?: string;
  due_on?: string;
  subtotal?: number;
  tax_gst?: number;
  tax_qst?: number;
  total?: number;
  confidence?: "high" | "medium" | "low";
  notes?: string;
};

export type AiProvider = "gemini" | "anthropic";

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: "gemini-3.8-flash",
  anthropic: "claude-sonnet-5-5",
};

const SYSTEM = `You read construction quotes ("soumissions") and invoices ("factures") issued by or to a general contractor in Quebec, Canada.
Documents may be in French or English. Amounts are in Canadian dollars. Quebec taxes: GST/TPS 5% and QST/TVQ 9.975%.
Record exactly what is printed on the document by calling the record_document tool. Never invent values: leave a field out when it is not on the document.
"total" is the final amount payable including taxes. If only a total is printed, still record it.
Dates must be YYYY-MM-DD. "title" is a short description of the work or project the document is about.`;

const TOOL = {
  name: "record_document",
  description: "Record the data read from the quote or invoice.",
  input_schema: {
    type: "object",
    properties: {
      number: { type: "string", description: "Document number, for example FAC-2601 or SOU-2601." },
      title: { type: "string", description: "Short description of the work or project." },
      client_name: { type: "string", description: "Customer name as printed." },
      issued_on: { type: "string", description: "Issue date, YYYY-MM-DD." },
      due_on: { type: "string", description: "Due date (invoices) or validity date (quotes), YYYY-MM-DD." },
      subtotal: { type: "number", description: "Amount before taxes." },
      tax_gst: { type: "number", description: "GST / TPS amount." },
      tax_qst: { type: "number", description: "QST / TVQ amount." },
      total: { type: "number", description: "Final total including taxes." },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      notes: { type: "string", description: "Anything staff should double-check, in one short sentence." },
    },
    required: ["total", "confidence"],
  },
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function num(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

function clean(raw: Record<string, unknown>): Extracted {
  const out: Extracted = {};
  if (typeof raw.number === "string" && raw.number.trim()) out.number = raw.number.trim().slice(0, 60);
  if (typeof raw.title === "string" && raw.title.trim()) out.title = raw.title.trim().slice(0, 200);
  if (typeof raw.client_name === "string" && raw.client_name.trim()) out.client_name = raw.client_name.trim().slice(0, 160);
  if (typeof raw.issued_on === "string" && DATE.test(raw.issued_on)) out.issued_on = raw.issued_on;
  if (typeof raw.due_on === "string" && DATE.test(raw.due_on)) out.due_on = raw.due_on;
  out.subtotal = num(raw.subtotal);
  out.tax_gst = num(raw.tax_gst);
  out.tax_qst = num(raw.tax_qst);
  out.total = num(raw.total);
  if (out.total === undefined && out.subtotal !== undefined) {
    out.total = Math.round((out.subtotal + (out.tax_gst ?? 0) + (out.tax_qst ?? 0)) * 100) / 100;
  }
  out.confidence = raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low" ? raw.confidence : "low";
  if (typeof raw.notes === "string" && raw.notes.trim()) out.notes = raw.notes.trim().slice(0, 300);
  return out;
}

type Mime = "application/pdf" | "image/png" | "image/jpeg";

async function viaAnthropic(input: { apiKey: string; model: string; mime: Mime; base64: string; prompt: string; signal: AbortSignal }) {
  const block =
    input.mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: input.mime, data: input.base64 } }
      : { type: "image", source: { type: "base64", media_type: input.mime, data: input.base64 } };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: input.signal,
    headers: { "content-type": "application/json", "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: [block, { type: "text", text: input.prompt }] }],
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    content?: { type: string; name?: string; input?: Record<string, unknown> }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(payload.error?.message || `AI request failed (${res.status})`);
  const call = payload.content?.find((c) => c.type === "tool_use" && c.name === TOOL.name);
  if (!call?.input) throw new Error("The AI did not return any data.");
  return call.input;
}

/** Gemini wants OpenAPI-style upper-case types in its response schema. */
const GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    number: { type: "STRING" },
    title: { type: "STRING" },
    client_name: { type: "STRING" },
    issued_on: { type: "STRING" },
    due_on: { type: "STRING" },
    subtotal: { type: "NUMBER" },
    tax_gst: { type: "NUMBER" },
    tax_qst: { type: "NUMBER" },
    total: { type: "NUMBER" },
    confidence: { type: "STRING", enum: ["high", "medium", "low"] },
    notes: { type: "STRING" },
  },
  required: ["total", "confidence"],
};

async function viaGemini(input: { apiKey: string; model: string; mime: Mime; base64: string; prompt: string; signal: AbortSignal }) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`, {
    method: "POST",
    signal: input.signal,
    headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: input.mime, data: input.base64 } }, { text: input.prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseSchema: GEMINI_SCHEMA,
      },
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(payload.error?.message || `AI request failed (${res.status})`);
  const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("The AI did not return any data.");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Some models wrap the JSON in a code fence.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The AI did not return valid data.");
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

/** Cheap round trip that proves the provider, key and model work. Throws with the provider's message otherwise. */
export async function testConnection(input: { provider: AiProvider; apiKey: string; model?: string }) {
  const model = input.model || DEFAULT_MODELS[input.provider];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    if (input.provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: "user", content: "Reply with the single word OK." }] }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(payload.error?.message || `AI request failed (${res.status})`);
    } else {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with the single word OK." }] }], generationConfig: { maxOutputTokens: 16 } }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(payload.error?.message || `AI request failed (${res.status})`);
    }
    return { provider: input.provider, model };
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeDocument(input: {
  provider: AiProvider;
  apiKey: string;
  model?: string;
  mime: Mime;
  base64: string;
  kind: "invoice" | "quote" | "supplier";
}): Promise<Extracted> {
  const label =
    input.kind === "quote"
      ? "quote (soumission)"
      : input.kind === "supplier"
        ? "supplier invoice (facture de fournisseur) received by a general contractor: put the supplier who issued it in client_name"
        : "invoice (facture)";
  const prompt = `This document is a ${label}. Read it and record the data.`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const run = input.provider === "anthropic" ? viaAnthropic : viaGemini;
    const raw = await run({
      apiKey: input.apiKey,
      model: input.model || DEFAULT_MODELS[input.provider],
      mime: input.mime,
      base64: input.base64,
      prompt,
      signal: controller.signal,
    });
    return clean(raw);
  } finally {
    clearTimeout(timer);
  }
}

const SUMMARY_SYSTEM = `You write the short daily briefing shown at the top of a construction company's project dashboard.
You receive JSON facts about the projects, their achievement (percent of tasks done), schedule and upcoming deadlines.
Write 3 to 4 short sentences, 75 words at most, in a warm and direct tone, in the requested language.
Say how the projects are doing overall, name what is late or needs attention first, then the next deadlines worth knowing about.
Use only the facts given: never invent a project, a number or a date. Do not mention money. Plain text only: no markdown, no lists, no greeting.`;

const PROJECT_SYSTEM = `You write the short "work in progress" message at the top of a construction project's overview page. The client reads it.
You receive JSON facts about the project: phase, progress, finished work and what comes next.
Write 2 to 3 short sentences, 60 words at most, in the requested language. The tone is warm, confident and reassuring: celebrate what is done, say what is happening now and what comes next.
Never mention delays, problems, risks, lateness, money or anything that could worry the client. If something is behind, simply do not mention it.
Use only the facts given: never invent work, dates or numbers. Plain text only: no markdown, no lists, no greeting.`;

const FORECAST_SYSTEM = `You are a scheduling assistant for a general contractor. You receive JSON about a project's tasks: planned dates, a computed forecast, progress, and which tasks wait on others (dependencies).
Write a short, practical analysis for the project manager in the requested language: 4 to 7 lines, each starting with "- ".
Say whether the project is likely to finish on its planned end date; name the specific tasks or chains that hold things up and why (an unfinished predecessor, work not started past its date, slow progress); and give one concrete action for each main problem (for example start X earlier, add crew on Y, confirm the delivery of Z).
Use only the facts given: never invent tasks, dates or numbers. Plain text only: no markdown other than the leading "- ".`;

const MORNING_SYSTEM = `You write the editorial of "La Gazette FRX", a short morning newspaper-style email for one employee of a construction company in Quebec.
You receive JSON facts: the employee's first name, today's date, their tasks (overdue, today, coming up), their calendar events for today and the projects they work on.
Write 4 to 6 short sentences in the requested language, in a warm, lively newspaper tone with one catchy headline on the first line (no "#", no quotes). Then a blank line and the text.
Say what the day looks like, what is urgent first (overdue or due today), then the meetings, then what is coming. Be encouraging but honest.
Use only the facts given: never invent a task, project, person, time or number. Plain text only: no markdown, no lists, no emojis.`;

/** Turns the dashboard's facts into a few readable sentences. */
export async function writeSummary(input: {
  provider: AiProvider;
  apiKey: string;
  model?: string;
  language: "fr" | "en";
  facts: unknown;
  kind?: "dashboard" | "project" | "forecast" | "morning";
}): Promise<string> {
  const system = input.kind === "project" ? PROJECT_SYSTEM : input.kind === "forecast" ? FORECAST_SYSTEM : input.kind === "morning" ? MORNING_SYSTEM : SUMMARY_SYSTEM;
  const model = input.model || DEFAULT_MODELS[input.provider];
  const prompt = `Language: ${input.language === "fr" ? "French (Quebec)" : "English"}\nFacts:\n${JSON.stringify(input.facts)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    if (input.provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: input.kind === "forecast" || input.kind === "morning" ? 900 : 400, system, messages: [{ role: "user", content: prompt }] }),
      });
      const payload = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
      if (!res.ok) throw new Error(payload.error?.message || `AI request failed (${res.status})`);
      const text = payload.content?.map((c) => (c.type === "text" ? c.text ?? "" : "")).join("").trim();
      if (!text) throw new Error("The AI did not return any text.");
      return text;
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: input.kind === "forecast" || input.kind === "morning" ? 1200 : 600 },
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(payload.error?.message || `AI request failed (${res.status})`);
    const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    if (!text) throw new Error("The AI did not return any text.");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

const CORRECT_SYSTEM = `You are a proofreader for a construction company in Quebec. Correct the spelling, grammar, accents and punctuation of the text the user sends.
Keep the meaning, the tone, the language, the line breaks, numbers, names, abbreviations and any technical or trade words exactly as they are. Do not add, remove or reorder ideas. Do not translate.
Reply with the corrected text only: no quotes, no comments, no explanation.`;

/** Fixes spelling and grammar of a short text, in the language asked. Returns the text unchanged when nothing needs fixing. */
export async function correctText(input: { provider: AiProvider; apiKey: string; model?: string; language: "fr" | "en"; text: string }): Promise<string> {
  const model = input.model || DEFAULT_MODELS[input.provider];
  const system = `${CORRECT_SYSTEM}\nThe text is written in ${input.language === "fr" ? "French (Quebec)" : "English (Canada)"}.`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    if (input.provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 2000, temperature: 0, system, messages: [{ role: "user", content: input.text }] }),
      });
      const payload = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
      if (!res.ok) throw new Error(payload.error?.message || `AI request failed (${res.status})`);
      const text = payload.content?.map((c) => (c.type === "text" ? c.text ?? "" : "")).join("");
      if (!text?.trim()) throw new Error("The AI did not return any text.");
      return text.replace(/^\s+|\s+$/g, "");
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: input.text }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 2000 },
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(payload.error?.message || `AI request failed (${res.status})`);
    const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text?.trim()) throw new Error("The AI did not return any text.");
    return text.replace(/^\s+|\s+$/g, "");
  } finally {
    clearTimeout(timer);
  }
}
