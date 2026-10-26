import { FormEvent, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthButton, AuthCard, AuthScreen, authFieldClass } from "@/components/AuthScreen";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const labelClass = "font-display text-[13px] font-medium uppercase tracking-[0.28em] text-[#a3a3a0]";

export function LoginPage() {
  const { user, ready, login, needsSetup, setupAdmin } = useAuth();
  const { t, locale, tr } = useI18n();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (ready && user) return <Navigate to={from} replace />;

  function translate(msg: string) {
    const translated = t(msg as "login.error.invalid");
    return translated === msg || translated.startsWith("login.") ? msg : translated;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const msg = needsSetup ? await setupAdmin({ name, email, password }) : await login(email, password);
      if (msg) setError(translate(msg));
    } catch (err) {
      setError(tr(err, "login.error.invalid"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onForgot(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/db", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_password_reset", email: email.trim(), locale }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 429) setError(translate(data.error || "login.error.throttled"));
      else setNotice(t("login.forgot.sent"));
    } catch {
      // Same neutral answer when the request cannot be made, so nothing is revealed.
      setNotice(t("login.forgot.sent"));
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(next: "signin" | "forgot") {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  const errorBox = error ? (
    <p className="mt-5 border-l-2 border-[#fbaa19] bg-[#fbaa19]/10 px-3 py-2.5 text-sm text-[#fbd28a]" role="alert">
      {error}
    </p>
  ) : null;

  return (
    <AuthScreen>
      <AuthCard>
        {mode === "forgot" && !needsSetup ? (
          <form onSubmit={onForgot}>
            <h2 className="font-display text-[34px] leading-none">{t("login.forgot.title")}</h2>
            <p className="mt-3 text-sm text-[#a3a3a0]">{t("login.forgot.hint")}</p>
            <div className="mt-6 space-y-2">
              <Label htmlFor="forgot-email" className={labelClass}>
                {t("login.email")}
              </Label>
              <Input
                id="forgot-email"
                type="email"
                autoComplete="username"
                placeholder={t("login.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className={authFieldClass}
              />
            </div>
            {notice ? (
              <p className="mt-5 border-l-2 border-[#fbaa19] bg-[#fbaa19]/10 px-3 py-2.5 text-sm text-[#fbd28a]" role="status">
                {notice}
              </p>
            ) : null}
            {errorBox}
            <AuthButton type="submit" disabled={submitting}>
              <span>{t("login.forgot.send")}</span>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            </AuthButton>
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="mx-auto mt-5 block text-[13px] text-[#8a8a86] transition-colors hover:text-[#fbaa19]"
            >
              {t("login.forgot.back")}
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmit}>
            {needsSetup ? <p className="mb-5 text-sm text-[#a3a3a0]">{t("login.setup.hint")}</p> : null}
            <div className="space-y-5 [@media(max-height:800px)]:space-y-4">
              {needsSetup ? (
                <div className="space-y-2">
                  <Label htmlFor="name" className={labelClass}>
                    {t("login.setup.name")}
                  </Label>
                  <Input
                    id="name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className={authFieldClass}
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="email" className={labelClass}>
                  {t("login.email")}
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder={t("login.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className={authFieldClass}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className={labelClass}>
                  {t("login.password")}
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={needsSetup ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={needsSetup ? 8 : undefined}
                    className={cn(authFieldClass, "pr-12")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[#8a8a86] hover:text-[#fbaa19]"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {!needsSetup ? (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="text-[12px] text-[#7d7d79] transition-colors hover:text-[#fbaa19]"
                    >
                      {t("login.forgot")}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {errorBox}

            <AuthButton type="submit" disabled={submitting || !ready}>
              <span>{needsSetup ? t("login.setup.submit") : t("login.enter")}</span>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />}
            </AuthButton>
          </form>
        )}
      </AuthCard>
    </AuthScreen>
  );
}
