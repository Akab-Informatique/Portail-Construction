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
  kind: "invoice" | "quote";
}): Promise<Extracted> {
  const prompt = `This document is a ${input.kind === "quote" ? "quote (soumission)" : "invoice (facture)"}. Read it and record the data.`;
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
