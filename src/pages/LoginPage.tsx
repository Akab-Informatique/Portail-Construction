import { FormEvent, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BorderBeam } from "@/components/ui/border-beam";
import { BuildingElevation } from "@/components/BuildingElevation";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const fieldClass =
  "h-12 rounded-sm border-[#2e2e2c] bg-black/60 px-4 text-[15px] text-white placeholder:text-[#6b6b68] focus-visible:border-[#fbaa19] focus-visible:ring-[3px] focus-visible:ring-[#fbaa19]/25";

/** Warm, slowly drifting light pools — the "site lights at dusk" backdrop. */
function Glow({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div
        className="absolute -left-[20%] -top-[25%] h-[80%] w-[80%] rounded-full"
        style={{
          background: "radial-gradient(closest-side, rgba(251,170,25,0.22), transparent)",
          animation: "frx-drift 14s ease-in-out infinite",
        }}
      />
      <div
        className="absolute -bottom-[30%] -right-[15%] h-[75%] w-[75%] rounded-full"
        style={{
          background: "radial-gradient(closest-side, rgba(251,170,25,0.14), transparent)",
          animation: "frx-drift 18s ease-in-out -6s infinite reverse",
        }}
      />
    </div>
  );
}

/** Faint drafting grid. */
function Grid() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_90%_80%_at_40%_40%,#000_35%,transparent)]"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
        backgroundSize: "80px 80px, 80px 80px, 16px 16px, 16px 16px",
      }}
    />
  );
}

export function LoginPage() {
  const { user, ready, login, needsSetup, setupAdmin } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (ready && user) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const msg = needsSetup ? await setupAdmin({ name, email, password }) : await login(email, password);
      if (msg) {
        const translated = t(msg as "login.error.invalid");
        setError(translated === msg || translated.startsWith("login.") ? msg : translated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.error.invalid"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative grid min-h-screen overflow-hidden bg-black text-white lg:grid-cols-[1.2fr_1fr]">
      <Glow />

      {/* Brand panel: the job site */}
      <section className="relative hidden flex-col overflow-hidden border-r border-white/[0.06] lg:flex">
        <Grid />
        <div className="relative flex h-screen flex-col px-12 pb-8 pt-12 xl:px-16 xl:pt-16">
          <div className="flex items-center gap-3">
            <img src="/brand/logo-icon.png" alt="" className="size-11 object-contain" />
            <div className="leading-none">
              <p className="font-display text-xl font-bold tracking-[0.2em]">FRX</p>
              <p className="mt-1 font-display text-[11px] font-semibold tracking-[0.36em] text-[#fbaa19]">
                {t("brand.construction")}
              </p>
            </div>
          </div>

          <div className="mt-[6vh] max-w-xl">
            <p className="frx-label mb-6 flex items-center gap-3 text-[#fbaa19]">
              <span className="h-px w-10 bg-[#fbaa19]" aria-hidden />
              {t("brand.slogan")}
            </p>
            <h1 className="font-display text-[clamp(52px,6.2vw,96px)] font-bold leading-[0.9] tracking-tight">
              <span className="block">{t("login.hero.line1")}</span>
              <span className="block text-[#fbaa19] [text-shadow:0_0_40px_rgba(251,170,25,0.35)]">
                {t("login.hero.line2")}
              </span>
              <span className="block">{t("login.hero.line3")}</span>
            </h1>
            <p className="mt-7 max-w-md text-[15px] leading-relaxed text-[#a3a3a0]">{t("login.hero.body")}</p>
          </div>

          <div className="relative -mr-12 mt-auto flex justify-end pt-6 xl:-mr-16">
            <BuildingElevation className="block h-[min(40vh,460px)] w-auto max-w-full" />
          </div>
        </div>
      </section>

      {/* Sign-in panel */}
      <section className="relative flex flex-col">
        <div className="frx-beam h-1 w-full lg:hidden" aria-hidden />
        <div className="relative flex items-center justify-between px-6 py-5 sm:px-10">
          <div className="flex items-center gap-2.5 lg:invisible">
            <img src="/brand/logo-icon.png" alt="" className="size-8 object-contain" />
            <span className="font-display text-base font-bold tracking-[0.2em]">FRX</span>
          </div>
          <div className="flex overflow-hidden rounded-sm border border-[#2e2e2c] bg-black/60" role="group" aria-label="Language">
            {(["en", "fr"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLocale(code)}
                aria-pressed={locale === code}
                className={cn(
                  "frx-label min-w-11 px-3 py-2 transition-colors",
                  locale === code ? "bg-[#fbaa19] text-black" : "text-[#8a8a86] hover:text-white",
                )}
              >
                {code}
              </button>
            ))}
          </div>
        </div>

        <div className="relative flex flex-1 items-center justify-center px-5 pb-16 sm:px-10">
          <div className="relative w-full max-w-[420px] overflow-hidden rounded-md border border-white/[0.09] bg-[#0b0b0b]/85 p-8 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-sm sm:p-10">
            <BorderBeam size={160} duration={9} borderWidth={2} colorFrom="#fbaa19" colorTo="#fff4d4" />
            <BorderBeam size={100} duration={9} delay={4.5} borderWidth={2} colorFrom="#fff4d4" colorTo="#fbaa19" />

            <form onSubmit={onSubmit} className="relative">
              <p className="frx-label flex items-center gap-2 text-[#8a8a86]">
                <Lock className="size-3 text-[#fbaa19]" />
                {t("login.secure")}
              </p>
              <h2 className="mt-4 font-display text-[42px] font-bold leading-none">
                {needsSetup ? t("login.setup.submit") : t("login.title")}
              </h2>
              <span className="mt-4 block h-[3px] w-12 bg-[#fbaa19]" aria-hidden />
              <p className="mt-4 text-sm text-[#a3a3a0]">{needsSetup ? t("login.setup.hint") : t("login.subtitle")}</p>

              <div className="mt-8 space-y-5">
                {needsSetup ? (
                  <div className="space-y-2">
                    <Label htmlFor="name" className="frx-label text-[#a3a3a0]">
                      {t("login.setup.name")}
                    </Label>
                    <Input
                      id="name"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className={fieldClass}
                    />
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="email" className="frx-label text-[#a3a3a0]">
                    {t("login.email")}
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    placeholder={locale === "fr" ? "nom@entreprise.ca" : "name@company.ca"}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    className={fieldClass}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="frx-label text-[#a3a3a0]">
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
                      className={cn(fieldClass, "pr-12")}
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
                </div>
              </div>

              {error && (
                <p
                  className="mt-5 border-l-2 border-[#fbaa19] bg-[#fbaa19]/10 px-3 py-2.5 text-sm text-[#fbd28a]"
                  role="alert"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting || !ready}
                className="group mt-8 flex h-12 w-full items-center justify-between rounded-sm bg-[#fbaa19] px-5 font-display text-[16px] font-bold uppercase tracking-[0.18em] text-black shadow-[inset_0_-3px_0_rgba(0,0,0,0.2),0_0_30px_-6px_rgba(251,170,25,0.55)] transition-colors hover:bg-[#ffb935] active:translate-y-px disabled:opacity-60"
              >
                <span>{needsSetup ? t("login.setup.submit") : t("login.enter")}</span>
                {submitting ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
                )}
              </button>
            </form>
          </div>
        </div>
        <p className="frx-label relative pb-6 text-center text-[#4a4a47]">© {new Date().getFullYear()} FRX Construction</p>
      </section>
    </div>
  );
}
