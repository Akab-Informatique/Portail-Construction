import type { User } from "@/lib/types";

export type TeamMember = { user_id: number; role: string };

/** One person on a project team, with only what a team card may show: name, role and work contact details. */
export type TeamEntry = {
  id: number;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  lead: boolean;
};

/** A project lead is recognised from the role given on the team, for example "Project Manager" or "Chargé de projet". */
const LEAD_ROLE = /project\s*manager|project\s*lead|\blead\b|chargé|charge de projet|chef de projet|gestionnaire|responsable/i;

/**
 * The project's team in display order: lead first, then by name. A membership whose person cannot be read here
 * (a deleted account, or one this viewer may not see) is skipped rather than breaking the list, and someone listed
 * twice is shown once. Nothing is filtered on is_active: being on the team is what counts.
 */
export function projectTeam(members: TeamMember[], people: User[]): TeamEntry[] {
  const byId = new Map(people.map((p) => [p.id, p] as const));
  const seen = new Set<number>();
  const team: TeamEntry[] = [];
  for (const m of members) {
    const person = byId.get(m.user_id);
    if (!person || seen.has(m.user_id)) continue;
    seen.add(m.user_id);
    const role = (m.role || "").trim() || person.title?.trim() || "";
    const email = (person.email || "").trim();
    team.push({
      id: person.id,
      name: (person.name || "").trim() || email,
      role,
      email: email || null,
      phone: person.phone?.trim() || null,
      lead: LEAD_ROLE.test(role),
    });
  }
  return team.sort((a, b) => Number(b.lead) - Number(a.lead) || a.name.localeCompare(b.name));
}
