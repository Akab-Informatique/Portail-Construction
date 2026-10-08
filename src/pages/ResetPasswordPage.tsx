import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthButton, AuthCard, AuthScreen, authFieldClass } from "@/components/AuthScreen";
import { useI18n } from "@/lib/i18n";

const labelClass = "font-display text-[13px] font-medium uppercase tracking-[0.28em] text-[#a3a3a0]";

export function ResetPasswordPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(token ? null : t("reset.invalidLink"));
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("reset.mismatch"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/db", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_password", token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; local?: boolean };
      if (data.ok) {
        setDone(true);
      } else {
        const key = data.error && !data.local ? data.error : "reset.invalidLink";
        const translated = t(key as "reset.invalidLink");
        setError(translated === key ? t("reset.invalidLink") : translated);
      }
    } catch {
      setError(t("reset.invalidLink"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen>
      <AuthCard>
        {done ? (
          <div>
            <p className="text-sm text-[#d6d6d2]">{t("reset.done")}</p>
            <Link to="/login" className="mt-6 block">
              <span className="flex justify-center drop-shadow-[0_0_14px_rgba(251,170,25,0.45)]">
                <span
                  style={{ clipPath: "polygon(0 0, 100% 0, 100% 55%, 14% 100%, 0 100%)" }}
                  className="flex h-11 min-w-[210px] items-center justify-start gap-3 bg-[#fbaa19] pl-7 pr-14 font-display text-[20px] uppercase tracking-[0.22em] text-black"
                >
                  {t("reset.toLogin")}
                  <ArrowRight className="size-4" />
                </span>
              </span>
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <h2 className="font-display text-[34px] leading-none">{t("reset.title")}</h2>
            <p className="mt-3 text-sm text-[#a3a3a0]">{t("reset.hint")}</p>
            <div className="mt-6 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="new-password" className={labelClass}>
                  {t("reset.password")}
                </Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={authFieldClass}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password" className={labelClass}>
                  {t("reset.confirm")}
                </Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={authFieldClass}
                />
              </div>
            </div>
            {error ? (
              <p className="mt-5 border-l-2 border-[#fbaa19] bg-[#fbaa19]/10 px-3 py-2.5 text-sm text-[#fbd28a]" role="alert">
                {error}
              </p>
            ) : null}
            <AuthButton type="submit" disabled={submitting || !token}>
              <span>{t("reset.submit")}</span>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            </AuthButton>
            <Link to="/login" className="mx-auto mt-5 block text-center text-[13px] text-[#8a8a86] hover:text-[#fbaa19]">
              {t("login.forgot.back")}
            </Link>
          </form>
        )}
      </AuthCard>
    </AuthScreen>
  );
}
