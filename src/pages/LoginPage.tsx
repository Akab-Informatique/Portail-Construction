import { FormEvent, useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BorderBeam } from "@/components/ui/border-beam";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const fieldClass =
  "h-12 rounded-sm border-[#2e2e2c] bg-black/60 px-4 text-[15px] text-white placeholder:text-[#6b6b68] focus-visible:border-[#fbaa19] focus-visible:ring-[3px] focus-visible:ring-[#fbaa19]/25";

/** Hairline construction lines, same style as the FRX brochure: thin orange verticals, horizontals and shallow diagonals. */
const LINES: [number, number, number, number][] = [
  // axis cluster, centre-left: vertical + 20° and 30° diagonals meeting at one point
  [560, -50, 560, 480],
  [-50, 552, 1100, 133],
  [-50, -22, 900, 526],
  // axis cluster, centre-right
  [1040, 430, 1040, 950],
  [600, 740, 1700, 340],
  [800, 441, 1650, 932],
  // a few accents
  [-50, 700, 480, 700],
  [1330, -50, 1330, 330],
  [1650, 150, 1150, -30],
  [-50, 900, 300, 774],
  // more verticals and horizontals
  [200, 420, 200, 950],
  [1470, -50, 1470, 520],
  [-50, 150, 330, 150],
  [1250, 640, 1650, 640],
  [1100, 860, 1650, 860],
];

function LineSet({ stroke, width }: { stroke: string; width: number }) {
  return (
    <svg className="absolute inset-0 size-full" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" fill="none">
      {LINES.map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={width} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/** Lines drift slightly against the cursor; a brighter copy is revealed in a spotlight around it. */
function Lines() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -inset-6"
      style={{ transform: "translate3d(calc(var(--px) * -14px), calc(var(--py) * -10px), 0)" }}
    >
      <div className="absolute inset-0 opacity-[0.38]">
        <LineSet stroke="#ffa62c" width={1.25} />
      </div>
      <div
        className="absolute inset-0"
        style={{
          WebkitMaskImage: "radial-gradient(circle 280px at var(--mx) var(--my), #000 0%, transparent 100%)",
          maskImage: "radial-gradient(circle 280px at var(--mx) var(--my), #000 0%, transparent 100%)",
        }}
      >
        <LineSet stroke="#ffb94a" width={2} />
      </div>
    </div>
  );
}

/** Orange site-light that follows the mouse. */
function MouseGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(circle 520px at var(--mx) var(--my), rgba(251,170,25,0.20), rgba(251,170,25,0.06) 45%, transparent 75%)",
      }}
    />
  );
}

/** Faint drafting grid. */
function Grid() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_100%_90%_at_50%_50%,#000_40%,transparent)]"
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

  const words = t("brand.slogan").split(" ");
  const slogan = { last: words.pop() ?? "", lead: words.join(" ") };
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cur = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const target = { ...cur };
    let raf = 0;
    const paint = () => {
      el.style.setProperty("--mx", `${cur.x}px`);
      el.style.setProperty("--my", `${cur.y}px`);
      el.style.setProperty("--px", String((cur.x / window.innerWidth - 0.5) * 2));
      el.style.setProperty("--py", String((cur.y / window.innerHeight - 0.5) * 2));
    };
    const tick = () => {
      cur.x += (target.x - cur.x) * 0.12;
      cur.y += (target.y - cur.y) * 0.12;
      paint();
      raf = Math.abs(target.x - cur.x) + Math.abs(target.y - cur.y) > 0.5 ? requestAnimationFrame(tick) : 0;
    };
    const onMove = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
      if (reduce) {
        cur.x = target.x;
        cur.y = target.y;
        paint();
      } else if (!raf) raf = requestAnimationFrame(tick);
    };
    paint();
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

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
    <div ref={rootRef} className="relative flex min-h-screen flex-col overflow-hidden bg-black text-white">
      <Grid />
      <MouseGlow />
      <Lines />
      <div className="frx-beam relative z-10 h-1 w-full" aria-hidden />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10 [@media(max-height:800px)]:py-3">
        <img
          src="/brand/frx-construction-logo-white.png"
          alt="FRX Construction"
          className="h-16 w-auto object-contain sm:h-[88px]"
        />
        <div className="flex overflow-hidden rounded-sm border border-[#2e2e2c] bg-black/60" role="group" aria-label="Language">
          {(["en", "fr"] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLocale(code)}
              aria-pressed={locale === code}
              className={cn(
                "font-display text-[13px] font-medium uppercase tracking-[0.28em] min-w-11 px-3 py-2 transition-colors",
                locale === code ? "bg-[#fbaa19] text-black" : "text-[#8a8a86] hover:text-white",
              )}
            >
              {code}
            </button>
          ))}
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 pb-10 pt-2">
        <div className="relative w-full max-w-[440px]">
          {/* Warm halo so the card reads as the lit centre of the site */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-10 rounded-[40px] bg-[radial-gradient(closest-side,rgba(251,170,25,0.18),transparent)] blur-xl"
          />
          {/* Brochure-style wedge: full height at the card's top-left, tapering to the top-right */}
          <p
            className="relative -mb-px flex h-[140px] flex-col items-start justify-end bg-[#ffa62c] px-8 pb-3 font-display text-[30px] uppercase leading-[1.1] tracking-[0.22em] text-white [@media(max-height:800px)]:h-[130px]"
            style={{ clipPath: "polygon(0 0, calc(100% - 250px) 0, 100% 91px, 100% 100%, 0 100%)" }}
          >
            <span className="font-['Barlow_Condensed'] text-[34px] font-normal tracking-[0.2em]">{slogan.lead}</span>
            <span className="font-['Barlow_Condensed'] text-[34px] font-normal tracking-[0.2em]">{slogan.last}.</span>
          </p>
          <div className="relative overflow-hidden rounded-md rounded-tl-none border border-white/[0.1] bg-[#0b0b0b]/90 p-8 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md sm:p-10 [@media(max-height:800px)]:p-7">
            <BorderBeam size={170} duration={9} borderWidth={2} colorFrom="#fbaa19" colorTo="#fff4d4" />
            <BorderBeam size={110} duration={9} delay={4.5} borderWidth={2} colorFrom="#fff4d4" colorTo="#fbaa19" />
              <form onSubmit={onSubmit} className="relative">
                <p className="font-display text-[13px] font-medium uppercase tracking-[0.28em] flex items-center gap-2 text-[#8a8a86]">
                  <Lock className="size-3 text-[#fbaa19]" />
                  {t("login.secure")}
                </p>
                <h2 className="mt-4 font-display text-[42px] font-bold leading-none [@media(max-height:800px)]:mt-3 [@media(max-height:800px)]:text-[36px]">
                  {needsSetup ? t("login.setup.submit") : t("login.title")}
                </h2>
                <span className="mt-4 block h-[3px] w-12 bg-[#fbaa19]" aria-hidden />
                <p className="mt-4 text-sm text-[#a3a3a0]">{needsSetup ? t("login.setup.hint") : t("login.subtitle")}</p>

                <div className="mt-8 space-y-5 [@media(max-height:800px)]:mt-6 [@media(max-height:800px)]:space-y-4">
                  {needsSetup ? (
                    <div className="space-y-2">
                      <Label htmlFor="name" className="font-display text-[13px] font-medium uppercase tracking-[0.28em] text-[#a3a3a0]">
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
                    <Label htmlFor="email" className="font-display text-[13px] font-medium uppercase tracking-[0.28em] text-[#a3a3a0]">
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
                    <Label htmlFor="password" className="font-display text-[13px] font-medium uppercase tracking-[0.28em] text-[#a3a3a0]">
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

                <div className="mt-8 flex justify-center drop-shadow-[0_0_14px_rgba(251,170,25,0.45)] [@media(max-height:800px)]:mt-6">
                  <button
                    type="submit"
                    disabled={submitting || !ready}
                    style={{ clipPath: "polygon(0 0, 100% 0, 100% 55%, 14% 100%, 0 100%)" }}
                    className="group flex h-11 min-w-[210px] items-center justify-start gap-3 bg-[#fbaa19] pl-7 pr-14 font-display text-[20px] uppercase tracking-[0.22em] text-black transition-colors hover:bg-[#ffb935] active:translate-y-px disabled:opacity-60"
                  >
                    <span>{needsSetup ? t("login.setup.submit") : t("login.enter")}</span>
                    {submitting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                    )}
                  </button>
                </div>
              </form>
          </div>
          <p className="font-display text-[13px] font-medium uppercase tracking-[0.28em] relative mt-5 text-center text-[#6b6b68]">© {new Date().getFullYear()} FRX Construction</p>
        </div>
      </main>

    </div>
  );
}
