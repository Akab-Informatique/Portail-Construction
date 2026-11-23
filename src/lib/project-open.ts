import { useEffect, useState } from "react";
import { and, eq } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import { useAuth } from "@/lib/auth";
import type { Project } from "@/lib/types";

/**
 * Whether a client may use the whole project. A new project is closed: the client only sees "Soumissions et factures"
 * until a quote on it has been accepted or an administrator publishes the project. Staff always have the whole project.
 */
export function useProjectOpen(project: Pick<Project, "id" | "published"> | null): boolean {
  const { user } = useAuth();
  const isClient = user?.user_type === "external" || user?.view_as === "client";
  const [accepted, setAccepted] = useState<boolean | null>(null);
  useEffect(() => {
    if (!project || !isClient || project.published === 1) return;
    let alive = true;
    void (async () => {
      try {
        await dbReady;
        const rows = await db
          .select({ id: schema.billing_files.id })
          .from(schema.billing_files)
          .where(and(eq(schema.billing_files.project_id, project.id), eq(schema.billing_files.kind, "quote"), eq(schema.billing_files.status, "accepted"), eq(schema.billing_files.published, 1)))
          .limit(1);
        if (alive) setAccepted(rows.length > 0);
      } catch {
        if (alive) setAccepted(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [project?.id, project?.published, isClient]);
  if (!isClient || !project) return true;
  return project.published === 1 || accepted === true;
}
