import { useEffect, useRef, useState } from "react";
import { Check, Loader2, SpellCheck, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { correctWithAi } from "@/lib/correct";
import { cn } from "@/lib/utils";

/** Staff only: clients never see the button, and it needs a signed-in session. */
function useCanCorrect() {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { user } = useAuth();
    return Boolean(user && user.user_type === "internal" && user.view_as !== "client");
  } catch {
    return false;
  }
}

/** Puts a value into a controlled React input from outside, so its own onChange runs. */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * The "Correct" pill that sits on the corner of a text box. It sends only the text in that box to the AI, in the
 * language chosen in the profile, and puts the corrected text back; "Undo" brings the original back.
 */
export function CorrectPill({ getEl, text, className }: { getEl: () => HTMLInputElement | HTMLTextAreaElement | null; text: string; className?: string }) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<"idle" | "busy" | "done" | "same" | "none" | "error">("idle");
  const original = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const settle = (next: typeof state, ms = 5000) => {
    setState(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), ms);
  };

  async function run() {
    const el = getEl();
    if (!el || state === "busy") return;
    const before = el.value;
    if (!before.trim()) return;
    setState("busy");
    const result = await correctWithAi(before, locale);
    if ("error" in result) return settle(result.error === "notConfigured" ? "none" : "error", 4000);
    const after = getEl();
    if (!after || after.value !== before) return settle("idle"); // the text changed while the AI worked: leave it alone
    if (result.text === before) return settle("same", 2500);
    original.current = before;
    setNativeValue(after, result.text);
    settle("done", 12000);
  }

  function undo() {
    const el = getEl();
    if (el && original.current !== null) setNativeValue(el, original.current);
    original.current = null;
    setState("idle");
  }

  if (state === "done")
    return (
      <button type="button" onClick={undo} className={pill(className)} title={t("correct.undo")}>
        <Undo2 className="size-3" />
        {t("correct.undo")}
      </button>
    );
  const label = state === "busy" ? t("correct.busy") : state === "same" ? t("correct.same") : state === "none" ? t("correct.notConfigured") : state === "error" ? t("correct.failed") : t("correct.button");
  return (
    <button type="button" disabled={state === "busy" || !text.trim()} onClick={() => void run()} className={pill(className)} title={t("correct.title")}>
      {state === "busy" ? <Loader2 className="size-3 animate-spin" /> : state === "same" ? <Check className="size-3" /> : <SpellCheck className="size-3" />}
      {label}
    </button>
  );
}

const pill = (extra?: string) =>
  cn(
    "absolute -bottom-2.5 right-2 z-10 inline-flex h-5 items-center gap-1 rounded-full border bg-background/95 px-2 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground disabled:opacity-60",
    extra,
  );

export { useCanCorrect };
