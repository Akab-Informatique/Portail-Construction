import { useEffect, useRef, type ReactNode } from "react";
import { BorderBeam } from "@/components/ui/border-beam";
import { InstallAppButton } from "@/components/InstallAppButton";
import { Logo } from "@/components/Logo";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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
        <LineSet stroke="#fbaa19" width={1.25} />
      </div>
      <div
        className="absolute inset-0"
        style={{
          WebkitMaskImage: "radial-gradient(circle 280px at var(--mx) var(--my), #000 0%, transparent 100%)",
          maskImage: "radial-gradient(circle 280px at var(--mx) var(--my), #000 0%, transparent 100%)",
        }}
      >
        <LineSet stroke="#ffc247" width={2} />
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

/** Full-screen branded backdrop with logo, language switch and a centred slot. */
export function AuthScreen({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
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

  return (
    <div ref={rootRef} className="relative flex min-h-screen flex-col overflow-hidden bg-black text-white">
      <Grid />
      <MouseGlow />
      <Lines />
      <div className="frx-beam relative z-10 h-1 w-full" aria-hidden />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10 [@media(max-height:800px)]:py-3">
        <Logo inverted className="h-11 sm:h-14" />
        <div className="flex items-center gap-2">
        <InstallAppButton tone="dark" />
        <div className="flex overflow-hidden rounded-none border border-[#2e2e2c] bg-black/60" role="group" aria-label={t("a11y.language")}>
          {(["en", "fr"] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLocale(code)}
              aria-pressed={locale === code}
              className={cn(
                "min-w-11 px-3 py-2 font-display text-[13px] uppercase tracking-[0.28em] transition-colors",
                locale === code ? "bg-[#fbaa19] text-black" : "text-[#8a8a86] hover:text-white",
              )}
            >
              {code}
            </button>
          ))}
        </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 pb-10 pt-2">
        <div className="relative w-full max-w-[440px]">
          {/* Warm halo so the card reads as the lit centre of the site */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-8 bg-[radial-gradient(closest-side,rgba(251,170,25,0.12),transparent)]"
          />
          {children}
          <p className="relative mt-5 text-center font-display text-[13px] uppercase tracking-[0.28em] text-[#6b6b68]">
            © {new Date().getFullYear()} FRX Construction
          </p>
        </div>
      </main>
    </div>
  );
}

/** The login card: the slogan wedge sits at its top, flush with the card edges. */
export function AuthCard({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const words = t("brand.slogan").split(" ");
  const last = words.pop() ?? "";
  const lead = words.join(" ");
  return (
    <div className="relative overflow-hidden rounded-none border border-[#3d3d39] bg-[#0b0b0b] p-8 pt-0 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.95)] sm:p-10 sm:pt-0 [@media(max-height:800px)]:p-7 [@media(max-height:800px)]:pt-0">
      <BorderBeam size={170} duration={9} borderWidth={2} colorFrom="#fbaa19" colorTo="#fff4d4" />
      <BorderBeam size={110} duration={9} delay={4.5} borderWidth={2} colorFrom="#fff4d4" colorTo="#fbaa19" />
      {/* Wedge: flat top, 20° slanted underside (same angle as the background diagonals) */}
      <p
        className="relative -mx-8 mb-7 flex h-[132px] flex-col items-start justify-end bg-[#fbaa19] px-8 pb-[34px] font-display text-[34px] font-normal uppercase leading-[1.1] tracking-[0.2em] text-white sm:-mx-10 sm:px-10 [@media(max-height:800px)]:-mx-7 [@media(max-height:800px)]:mb-5 [@media(max-height:800px)]:h-[116px] [@media(max-height:800px)]:px-7"
        style={{ clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 91px), calc(100% - 250px) 100%, 0 100%)" }}
      >
        <span>{lead}</span>
        <span>{last}.</span>
      </p>
      <div className="relative">{children}</div>
    </div>
  );
}

export const authFieldClass =
  "h-12 rounded-none border-[#2e2e2c] bg-black/60 px-4 text-[15px] text-white placeholder:text-[#6b6b68] focus-visible:border-[#fbaa19] focus-visible:ring-[3px] focus-visible:ring-[#fbaa19]/25";

/** Orange parallelogram-style action button used on the auth screens. */
export function AuthButton({
  children,
  ...props
}: { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <div className="mt-7 flex justify-center drop-shadow-[0_0_14px_rgba(251,170,25,0.45)] [@media(max-height:800px)]:mt-5">
      <button
        {...props}
        style={{ clipPath: "polygon(0 0, 100% 0, 100% 55%, 14% 100%, 0 100%)" }}
        className="group flex h-11 min-w-[210px] items-center justify-start gap-3 bg-[#fbaa19] pl-7 pr-14 font-display text-[20px] uppercase tracking-[0.22em] text-black transition-colors hover:bg-[#ffb935] active:translate-y-px disabled:opacity-60"
      >
        {children}
      </button>
    </div>
  );
}
