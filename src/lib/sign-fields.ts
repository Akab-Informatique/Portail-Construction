/** A box on a page of a quote's PDF where the client signs or dates it. Positions are fractions of the page (0..1). */
export type SignField = { id: string; type: "signature" | "date"; page: number; x: number; y: number; w: number; h: number };

const clamp = (n: unknown, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(Number(n)) ? Number(n) : min));

/** Reads the stored JSON; anything malformed is dropped. */
export function parseSignFields(raw: string | null | undefined): SignField[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((f) => f && (f.type === "signature" || f.type === "date"))
      .slice(0, 20)
      .map((f, i) => ({
        id: String(f.id ?? i).slice(0, 12),
        type: f.type as "signature" | "date",
        page: Math.max(1, Math.floor(Number(f.page) || 1)),
        x: clamp(f.x, 0, 1),
        y: clamp(f.y, 0, 1),
        w: clamp(f.w, 0.03, 1),
        h: clamp(f.h, 0.015, 1),
      }));
  } catch {
    return [];
  }
}
