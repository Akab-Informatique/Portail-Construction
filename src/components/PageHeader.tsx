import type { ReactNode } from "react";

/**
 * Page title block, styled like the title block on a construction drawing:
 * a mono reference line, a condensed title with a short yellow rule.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="frx-label mb-2 flex items-center gap-2 text-muted-foreground">
            <span className="inline-block size-2 bg-primary" aria-hidden />
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-[28px] font-bold leading-none tracking-tight text-foreground sm:text-[34px]">
          {title}
        </h1>
        <span className="mt-3 block h-[3px] w-12 bg-primary" aria-hidden />
        {description && <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
