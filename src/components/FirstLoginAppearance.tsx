import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import type { ThemePref } from "@/lib/types";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const EVENT = "frx:appearance";
const flag = (id: number) => `frx.appearance.${id}`;

function chosen(id: number | undefined) {
  if (!id) return true;
  try {
    return localStorage.getItem(flag(id)) === "1";
  } catch {
    return true;
  }
}

/** True once the person has picked light or dark at their first login; the tutorial waits for it. */
export function useAppearanceChosen() {
  const { realUser } = useAuth();
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  // People who already did their first login (tutorial done) are never asked.
  return Boolean(realUser?.tutorial_done) || chosen(realUser?.id);
}

/** The first thing a new person sees after choosing their password: light or dark. It can be changed later in the profile. */
export function FirstLoginAppearance() {
  const { realUser, updateProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const done = useAppearanceChosen();
  const [pick, setPick] = useState<ThemePref>(theme);
  if (!realUser || realUser.must_change_password || done) return null;

  async function confirm() {
    if (!realUser) return;
    setTheme(pick);
    await updateProfile({ theme: pick }).catch(() => undefined);
    try {
      localStorage.setItem(flag(realUser.id), "1");
    } catch {
      /* storage unavailable: the choice still applies for this session */
    }
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <Dialog open>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader className="items-center text-center">
          <Logo className="mb-2 h-10" />
          <DialogTitle>{t("first.title")}</DialogTitle>
          <DialogDescription>{t("first.desc")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["light", t("first.light"), Sun, "bg-[#f4f4f2] text-[#1c1c1c]"],
              ["dark", t("first.dark"), Moon, "bg-[#141414] text-white"],
            ] as const
          ).map(([id, label, Icon, look]) => (
            <button
              key={id}
              type="button"
              aria-pressed={pick === id}
              onClick={() => {
                setPick(id);
                setTheme(id);
              }}
              className={cn("flex h-32 flex-col items-center justify-center gap-2 rounded-xl border-2 transition-all", look, pick === id ? "border-primary shadow-lg" : "border-transparent opacity-80 hover:opacity-100")}
            >
              <Icon className="size-7" />
              <span className="font-display text-lg uppercase tracking-wide">{label}</span>
            </button>
          ))}
        </div>
        <Button onClick={() => void confirm()}>{t("first.continue")}</Button>
      </DialogContent>
    </Dialog>
  );
}
