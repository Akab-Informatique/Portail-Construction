import { notifySummary, sendNotification } from "@/lib/notify";
import { applyEmailTemplate, getCompanyProfile, getEmailTemplates, templateIn } from "@/lib/settings";
import type { Project, User } from "@/lib/types";

/**
 * Tells people by email that they now have access to a project, with the "Ajouté à un projet" template of the settings,
 * written in each recipient's own language. Returns a sentence when something could not be sent, otherwise an empty string.
 * Nothing is sent for a project that is not published to the client.
 */
export async function sendProjectAccessEmails(project: Project, userIds: number[], people: User[], t: (key: never) => string): Promise<string> {
  if (project.published !== 1 || userIds.length === 0) return "";
  const [templates, company] = await Promise.all([getEmailTemplates(), getCompanyProfile().catch(() => null)]);
  const link = `${window.location.origin}/projects/${project.id}`;
  const results = await Promise.all(
    userIds.map(async (id) => {
      const person = people.find((p) => p.id === id);
      const mail = applyEmailTemplate(templateIn(templates.project_access, person?.locale), {
        name: person?.name ?? "",
        project: `${project.project_number} ${project.name}`,
        link,
        company: company?.legal_name || "FRX",
      });
      return sendNotification({ userIds: [id], channels: ["email"], subject: mail.subject, text: mail.body }).catch(() => null);
    }),
  );
  const bad = results.find((r) => !r || r.error || r.dev || r.failed.length || r.skipped.length);
  return bad ? notifySummary(bad, t) : "";
}
