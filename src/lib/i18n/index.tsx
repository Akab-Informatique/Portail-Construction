import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LOCALE_KEY } from "../constants";
import type { Locale } from "../types";
import { en, type MessageKey } from "./en";
import { fr } from "./fr";

const DICTS: Record<Locale, Record<MessageKey, string>> = { en, fr };

type Vars = Record<string, string | number>;

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  /**
   * Translates a message coming from the server or an Error: a known key is
   * translated; "key:403" and "key|detail" keep the code/detail in brackets;
   * anything else (raw English from a third party) becomes `fallback` or a
   * generic message, so the UI never mixes languages.
   */
  tr: (message: unknown, fallback?: MessageKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function detectLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem(LOCALE_KEY);
  if (stored === "fr" || stored === "en") return stored;
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith("fr")) return "fr";
  return "en";
}

function interpolate(template: string, vars?: Vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    localStorage.setItem(LOCALE_KEY, locale);
    document.documentElement.lang = locale === "fr" ? "fr-CA" : "en-CA";
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem(LOCALE_KEY, next);
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Vars) => {
      const dict = DICTS[locale] ?? en;
      const raw = dict[key] ?? en[key] ?? key;
      return interpolate(raw, vars);
    },
    [locale],
  );

  const tr = useCallback(
    (message: unknown, fallback?: MessageKey) => {
      const dict = DICTS[locale] ?? en;
      const raw = message instanceof Error ? message.message : typeof message === "string" ? message : "";
      const [head, detail] = raw.split("|");
      const [key, code] = head.split(":");
      if (key && key in dict) {
        const text = dict[key as MessageKey];
        return detail ? `${text} [${detail}]` : code ? `${text} (HTTP ${code})` : text;
      }
      if (raw) console.warn("untranslated message:", raw);
      return dict[fallback ?? "err.generic"] ?? raw;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t, tr }), [locale, setLocale, t, tr]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

export function useT() {
  return useI18n().t;
}
