import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { buildFacts, cacheSummary, fallbackSummary, fetchAiSummary, readCachedSummary } from "@/lib/daily-summary";
import type { TaskLite } from "@/lib/project-progress";
import type { Client, Project } from "@/lib/types";

/** The day's briefing under the greeting. Written by the AI once a day and kept for the day; a basic version when no AI is set up. */
export function DailySummary({
  userId,
  projects,
  clients,
  tasks,
  dated,
}: {
  userId: number | undefined;
  projects: Project[];
  clients: Client[];
  tasks: TaskLite[];
  dated: { project_id: number; title: string; date: string }[];
}) {
  const { t, locale } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const latest = useRef({ projects, clients, tasks, dated });
  latest.current = { projects, clients, tasks, dated };

  const generate = useCallback(
    async (force: boolean) => {
      if (!force) {
        const cached = readCachedSummary(userId, locale);
        if (cached) {
          setText(cached.text);
          setAi(true);
          return;
        }
      }
      const { projects: p, clients: c, tasks: tk, dated: d } = latest.current;
      const facts = buildFacts(p, c, tk, d);
      setBusy(true);
      const written = p.length > 0 ? await fetchAiSummary(facts, locale) : null;
      if (written) {
        cacheSummary(userId, locale, written);
        setText(written);
        setAi(true);
      } else {
        setText(fallbackSummary(facts, t as never, locale));
        setAi(false);
      }
      setBusy(false);
    },
    [userId, locale, t],
  );

  useEffect(() => {
    void generate(false);
    // Once per day and language; the refresh button forces a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, locale]);

  return (
    <Card className="mb-6 flex-row items-start gap-4 p-5">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
        <Sparkles className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        {text === null ? (
          <div className="space-y-2 py-1">
            <div className="h-3.5 w-11/12 animate-pulse rounded bg-muted" />
            <div className="h-3.5 w-9/12 animate-pulse rounded bg-muted" />
          </div>
        ) : (
          <p className="text-[15px] leading-relaxed">{text}</p>
        )}
        <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{ai ? t("dash.sum.ai") : t("dash.sum.basic")}</p>
      </div>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={t("dash.sum.refresh")} disabled={busy} onClick={() => void generate(true)}>
        <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
      </Button>
    </Card>
  );
}
