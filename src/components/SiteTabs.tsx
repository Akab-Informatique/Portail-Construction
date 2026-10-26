import type { LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

export type SiteTab = { to: string; label: string; icon: LucideIcon };

/** Chamfered top corners, like a cut steel plate. */
const PLATE = "polygon(10px 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%, 0 10px)";

function Rivet({ active, side }: { active: boolean; side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-2 size-1.5 rounded-full",
        side === "left" ? "left-3" : "right-3",
        active
          ? "bg-black/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
          : "bg-white/25 shadow-[inset_0_-1px_0_rgba(0,0,0,0.6)]",
      )}
    />
  );
}

/**
 * Construction-style tabs: each tab is a riveted steel site plate (yellow when
 * active) standing on a yellow beam. Links, so each tab keeps its own URL.
 * To go back to plain tabs, swap this component for the ui/tabs list.
 */
export function SiteTabs({ tabs, className }: { tabs: SiteTab[]; className?: string }) {
  return (
    <nav className={cn("mb-6", className)} aria-label={tabs.map((tab) => tab.label).join(" / ")}>
      <div className="flex flex-wrap items-end gap-2 pl-2">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end
            style={{ clipPath: PLATE }}
            className={({ isActive }) =>
              cn(
                "group relative flex h-12 items-center gap-2.5 px-7 font-display text-[15px] font-bold uppercase tracking-[0.18em] transition-[transform,background-color,color] duration-150",
                isActive
                  ? "translate-y-0 bg-primary text-black shadow-[inset_0_2px_0_rgba(255,255,255,0.45),inset_0_-3px_0_rgba(0,0,0,0.18)]"
                  : "translate-y-1 bg-gradient-to-b from-[#2a2a29] to-[#151515] text-white/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:translate-y-0.5 hover:text-white",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Rivet active={isActive} side="left" />
                <Rivet active={isActive} side="right" />
                <tab.icon className={cn("size-4", isActive ? "text-black" : "text-primary")} />
                {tab.label}
              </>
            )}
          </NavLink>
        ))}
      </div>
      {/* The beam the plates stand on */}
      <div className="frx-beam h-[5px] w-full rounded-[1px] shadow-[0_2px_0_rgba(0,0,0,0.25)]" aria-hidden />
    </nav>
  );
}
