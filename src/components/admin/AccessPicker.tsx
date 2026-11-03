import { KeyRound, Mail } from "lucide-react";
import type { AccessDraft } from "@/lib/admin-access";
import { useI18n } from "@/lib/i18n";
import type { AccessGroup, Client, Project } from "@/lib/types";
import { GroupPicker } from "@/pages/config/GroupPicker";
import { LevelSelect, ProjectPicker } from "@/components/admin/parts";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * The access to give a person while creating them: the groups they belong to, the projects they open, their level on the
 * documentation library, and whether to email them the link to choose a password. Everything can be changed later in
 * Administration › Access rights.
 */
export function AccessPicker({
  groups,
  projects,
  clients,
  draft,
  onChange,
  docs = true,
  docsHint,
  invite = true,
}: {
  groups: AccessGroup[];
  projects: Project[];
  clients: Client[];
  draft: AccessDraft;
  onChange: (next: AccessDraft) => void;
  docs?: boolean;
  /** Shown under the level when it depends on something (a client user is capped by their company's level). */
  docsHint?: string;
  invite?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 rounded-xl border bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-primary" />
        <p className="text-sm font-semibold">{t("adm.accessTitle")}</p>
      </div>
      <GroupPicker groups={groups} selected={draft.groupIds} onChange={(groupIds) => onChange({ ...draft, groupIds })} />
      {projects.length > 0 ? (
        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium">{t("adm.projectsTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("adm.projectsCreateHint")}</p>
          </div>
          <ProjectPicker projects={projects} clients={clients} selected={draft.projectIds} onChange={(projectIds) => onChange({ ...draft, projectIds })} maxHeight="max-h-52" />
        </div>
      ) : null}
      {docs ? (
        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium">{t("adm.docsTitle")}</p>
            <p className="text-xs text-muted-foreground">{docsHint ?? t("adm.docsCreateHint")}</p>
          </div>
          <LevelSelect value={draft.docLevel} onChange={(docLevel) => onChange({ ...draft, docLevel })} />
        </div>
      ) : null}
      {invite ? (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox className="mt-0.5" checked={draft.invite} onCheckedChange={(v) => onChange({ ...draft, invite: v === true })} />
          <span>
            <span className="flex items-center gap-1.5 font-medium">
              <Mail className="size-3.5" />
              {t("adm.sendInvite")}
            </span>
            <span className="block text-xs text-muted-foreground">{t("adm.sendInviteHint")}</span>
          </span>
        </label>
      ) : null}
    </div>
  );
}
