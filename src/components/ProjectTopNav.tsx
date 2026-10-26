import { Fragment } from "react";
import { Link, NavLink } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { visibleProjectModules } from "@/lib/permissions";
import { PROJECT_NAV_GROUPS, projectSectionPath } from "@/lib/project-nav";
import { projectColor } from "@/lib/project-colors";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/types";

/**
 * The project's own menu, across the top of its page. The main sidebar never changes: this bar carries
 * every section of the project (overview, plan, field, controls) as pills, in the project's color.
 */
export function ProjectTopNav({ project, backLabel }: { project: Project; backLabel: string }) {
  const { t } = useI18n();
  const { user, permissions } = useAuth();
  const color = projectColor(project);
  const allowed = visibleProjectModules(user, permissions, project.id);
  const groups = PROJECT_NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => allowed.includes(n.id)) })).filter((g) => g.items.length > 0);

  return (
    <div className="sticky top-[3.75rem] z-20 mb-5">
      <div
        className="frx-glass flex items-center gap-1 border border-[color:var(--glass-edge)] p-1.5"
        style={{ boxShadow: `var(--glass-shadow), 0 10px 30px -18px ${color}` }}
      >
        <Link
          to="/documents/projects"
          title={backLabel}
          aria-label={backLabel}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden xl:inline">{backLabel}</span>
        </Link>
        <span className="h-6 w-px shrink-0 bg-border" aria-hidden />

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-2 px-1">
          {groups.map((group, gi) => (
            <Fragment key={group.id}>
              {gi > 0 ? <span className="mx-1 hidden h-5 w-px shrink-0 bg-border sm:block" aria-hidden /> : null}
              {group.items.map((item) => (
                <NavLink
                  key={item.id}
                  to={projectSectionPath(project.id, item.id)}
                  end={item.id === "dashboard"}
                  className={({ isActive }) =>
                    cn(
                      "group relative flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-[13.5px] font-medium whitespace-nowrap transition-all duration-200",
                      isActive ? "text-foreground" : "text-muted-foreground hover:-translate-y-px hover:bg-foreground/5 hover:text-foreground",
                    )
                  }
                  style={({ isActive }) =>
                    isActive
                      ? {
                          background: `linear-gradient(180deg, color-mix(in srgb, ${color} 24%, transparent), color-mix(in srgb, ${color} 10%, transparent))`,
                          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.35), inset 0 0 0 1px color-mix(in srgb, ${color} 40%, transparent), 0 6px 14px -8px ${color}`,
                        }
                      : undefined
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className="size-[17px] shrink-0 transition-colors" style={isActive ? { color } : undefined} />
                      {t(item.labelKey)}
                      {isActive ? <span className="absolute inset-x-3 -bottom-1.5 h-[3px] rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} /> : null}
                    </>
                  )}
                </NavLink>
              ))}
            </Fragment>
          ))}
        </div>

        {/* who we are in */}
        <div className="hidden shrink-0 items-center gap-2 border-l pl-3 pr-2 lg:flex">
          <span className="size-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 28%, transparent)` }} />
          <span className="font-display text-sm tracking-wide text-muted-foreground">{project.project_number}</span>
        </div>
      </div>
    </div>
  );
}
