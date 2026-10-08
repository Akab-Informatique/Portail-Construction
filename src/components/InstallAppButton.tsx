import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// The browser fires this once, early; keep it so the button can use it whenever it mounts.
let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    listeners.forEach((fn) => fn());
  });
}

/** Down arrow dropping into a software package (box). */
function PackageDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 1.5v8M8.5 6.5 12 10l3.5-3.5" />
      <path d="m12 11.5 8 3.5-8 3.5L4 15z" />
      <path d="M4 15v5l8 3.5 8-3.5v-5M12 18.5v5" />
    </svg>
  );
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isAndroid() {
  return /android/i.test(navigator.userAgent);
}
function isSafariDesktop() {
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/chrome|chromium|crios|edg|android/i.test(ua);
}
function isChromium() {
  return /chrome|chromium|edg/i.test(navigator.userAgent);
}

type HelpKey = "install.ios" | "install.android" | "install.safari" | "install.chromium" | "install.other";
function helpKey(): HelpKey {
  if (isIos()) return "install.ios";
  if (isAndroid()) return "install.android";
  if (isSafariDesktop()) return "install.safari";
  if (isChromium()) return "install.chromium";
  return "install.other";
}

/**
 * Discreet "add to home screen" button. Installs the site as a shortcut/PWA, not a store app.
 * Android/Chrome: native install prompt. iPhone/iPad: a short how-to, since Safari has no prompt.
 */
export function InstallAppButton({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  const { t } = useI18n();
  const [, force] = useState(0);
  const [help, setHelp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (!help) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setHelp(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [help]);

  if (typeof window === "undefined" || isStandalone()) return null;

  async function onClick() {
    if (deferredPrompt) {
      const evt = deferredPrompt;
      deferredPrompt = null;
      await evt.prompt();
      await evt.userChoice.catch(() => undefined);
      listeners.forEach((fn) => fn());
      return;
    }
    setHelp((v) => !v);
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => void onClick()}
        title={t("install.button")}
        aria-label={t("install.button")}
        className={cn(
          "flex size-9 items-center justify-center rounded-none border transition-colors",
          tone === "dark"
            ? "border-[#2e2e2c] bg-black/60 text-[#8a8a86] hover:text-[#fbaa19]"
            : "bg-card text-muted-foreground hover:text-foreground",
        )}
      >
        <PackageDownIcon className="size-[18px]" />
      </button>
      {help ? (
        <div
          role="dialog"
          className={cn(
            "absolute right-0 top-11 z-50 w-60 border p-3 text-left text-xs shadow-lg",
            tone === "dark" ? "border-[#2e2e2c] bg-[#121212] text-white" : "bg-popover text-popover-foreground",
          )}
        >
          <p className="font-display text-base leading-none">{t("install.title")}</p>
          <p className={cn("mt-2", tone === "dark" ? "text-[#a3a3a0]" : "text-muted-foreground")}>{t(helpKey())}</p>
        </div>
      ) : null}
    </div>
  );
}
