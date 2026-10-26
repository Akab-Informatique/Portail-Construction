import type { Client, Project, User } from "@/lib/types";

/** What every section of a project page receives. */
export type SectionProps = {
  project: Project;
  client: Client | null;
  people: User[];
  members: { user_id: number; role: string }[];
  /** Reload the project (and everything the shell holds) after a change. */
  reload: () => Promise<void>;
};
