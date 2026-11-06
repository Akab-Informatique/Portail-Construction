import { getSetting, setSetting } from "./settings";

/** How a numbered form is numbered: a prefix, a separator and a zero-padded running number (BT-0001). Set by an administrator in Setup. */
export type NumberingRule = { prefix: string; separator: string; digits: number; start: number };
export type NumberingConfig = Record<string, NumberingRule>;

export const FORM_NUMBERING_KEY = "form_numbering";
export const DEFAULT_RULE: NumberingRule = { prefix: "BT", separator: "-", digits: 4, start: 1 };

export const cleanRule = (r: Partial<NumberingRule> | undefined): NumberingRule => ({
  prefix: String(r?.prefix ?? DEFAULT_RULE.prefix).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase(),
  separator: ["-", "_", ".", "/", " ", ""].includes(String(r?.separator ?? "-")) ? String(r?.separator ?? "-") : "-",
  digits: Math.min(8, Math.max(1, Math.round(Number(r?.digits ?? DEFAULT_RULE.digits)) || DEFAULT_RULE.digits)),
  start: Math.max(1, Math.round(Number(r?.start ?? 1)) || 1),
});

export const formatNumber = (rule: NumberingRule, n: number) => `${rule.prefix}${rule.separator}${String(n).padStart(rule.digits, "0")}`;

/** The running part of a number written with this rule, or null when it was written with another one. */
export function parseNumber(rule: NumberingRule, value: string | null | undefined): number | null {
  if (!value) return null;
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const m = new RegExp(`^${esc(rule.prefix)}${esc(rule.separator)}(\\d+)$`).exec(value);
  return m ? Number(m[1]) : null;
}

export async function loadNumbering(): Promise<NumberingConfig> {
  try {
    const raw = await getSetting(FORM_NUMBERING_KEY);
    return raw ? (JSON.parse(raw) as NumberingConfig) : {};
  } catch {
    return {};
  }
}

export async function saveNumbering(config: NumberingConfig) {
  await setSetting(FORM_NUMBERING_KEY, JSON.stringify(config));
}
