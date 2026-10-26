import { desc, eq } from "drizzle-orm";
import { db, dbReady, schema } from "../db";
import type { Locale } from "./types";

export type FieldType = "text" | "longtext" | "date" | "time" | "number" | "yesno" | "select";

export type FormField = {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** For "select": the choices. */
  options?: string[];
};

export type FormSection = {
  id: string;
  title?: string;
  /** A section that can be filled several times (several visitors, several workers…). */
  repeat?: boolean;
  /** Wording of the "add another" button for a repeating section. */
  addLabel?: string;
  fields: FormField[];
};

export type FormDef = { sections: FormSection[] };

/** What was answered: for every section, one row of answers (several rows when the section repeats). */
export type FormData = Record<string, Record<string, string>[]>;

export type FormTemplate = {
  /** "builtin:<slug>" or "custom:<id>". */
  key: string;
  name: string;
  description: string;
  def: FormDef;
  builtin: boolean;
  id?: number;
};

const f = (id: string, label: string, type: FieldType = "text", extra: Partial<FormField> = {}): FormField => ({ id, label, type, ...extra });

/** The three forms the company starts with. Wording follows the paper versions. */
export function builtinForms(locale: Locale): FormTemplate[] {
  const fr = locale === "fr";
  const yes = fr ? ["Oui", "Non"] : ["Yes", "No"];
  void yes;
  return [
    {
      key: "builtin:daily-log",
      builtin: true,
      name: fr ? "Journal quotidien du chantier de construction" : "Daily construction site log",
      description: fr ? "Contremaître, visiteurs, travail effectué et main-d’œuvre de la journée." : "Foreman, visitors, work done and labour of the day.",
      def: {
        sections: [
          {
            id: "general",
            fields: [
              f("foreman", fr ? "Contremaître" : "Foreman", "text", { required: true }),
              f("contract", fr ? "No de contrat" : "Contract no.", "text", { required: true }),
              f("date", "Date", "date", { required: true }),
            ],
          },
          {
            id: "visitors",
            title: fr ? "Visiteurs" : "Visitors",
            repeat: true,
            addLabel: fr ? "Ajouter un visiteur" : "Add a visitor",
            fields: [f("name", fr ? "Nom du visiteur" : "Visitor name"), f("reason", fr ? "Raison de la visite" : "Reason for the visit")],
          },
          {
            id: "summary",
            fields: [f("summary", fr ? "Sommaire du travail effectué aujourd’hui" : "Summary of today’s work", "longtext", { required: true })],
          },
          {
            id: "workers",
            title: fr ? "Travail effectué par" : "Work done by",
            repeat: true,
            addLabel: fr ? "Ajouter un travailleur" : "Add a worker",
            fields: [f("name", fr ? "Nom du travailleur" : "Worker name"), f("trade", fr ? "Métier du travailleur" : "Worker’s trade"), f("hours", fr ? "Nombre d’heures effectuées" : "Hours worked", "number")],
          },
        ],
      },
    },
    {
      key: "builtin:work-order",
      builtin: true,
      name: fr ? "Bon de travail" : "Work order",
      description: fr ? "Exécutant, temps alloué, description des travaux, matériel acheté et autorisation." : "Who did it, time spent, description of the work, material bought and authorisation.",
      def: {
        sections: [
          {
            id: "executant",
            title: fr ? "Exécutant" : "Performed by",
            fields: [
              f("employee", fr ? "Nom de l’employé" : "Employee name", "text", { required: true }),
              f("date", "Date", "date", { required: true }),
              f("site", fr ? "Chantier / Lieu des travaux (adresse)" : "Job site / Work address", "text", { required: true }),
            ],
          },
          {
            id: "time",
            title: fr ? "Temps alloué et d’exécution" : "Time allowed and spent",
            fields: [f("arrival", fr ? "Heure d’arrivée" : "Arrival time", "time", { required: true }), f("departure", fr ? "Heure de départ" : "Departure time", "time", { required: true })],
          },
          {
            id: "description",
            title: "Description",
            fields: [
              f("report", fr ? "Compte-rendu / travaux effectués" : "Report / work done", "longtext", { required: true }),
              f("material", fr ? "Matériel acheté" : "Material bought", "yesno", { required: true }),
              f("remarks", fr ? "Remarque(s)" : "Remarks", "longtext"),
            ],
          },
          {
            id: "authorized",
            title: fr ? "Autorisé par" : "Authorised by",
            fields: [f("name", fr ? "Nom" : "Name"), f("date", "Date", "date")],
          },
        ],
      },
    },
    {
      key: "builtin:accident",
      builtin: true,
      name: fr ? "Formulaire d’accident de travail" : "Work accident form",
      description: fr ? "Employeur, victime et informations relatives à l’accident." : "Employer, victim and details of the accident.",
      def: {
        sections: [
          {
            id: "employer",
            title: fr ? "Employeur" : "Employer",
            fields: [
              f("supervisor", fr ? "Nom du superviseur sur les lieux lors de l’accident" : "Name of the supervisor on site at the time", "text", { required: true }),
              f("victim", fr ? "Nom de la victime de l’accident" : "Name of the victim", "text", { required: true }),
            ],
          },
          {
            id: "accident",
            title: fr ? "Les informations relatives à l’accident" : "Details of the accident",
            fields: [
              f("date", fr ? "Date de l’accident" : "Date of the accident", "date", { required: true }),
              f("time", fr ? "Heure de l’accident" : "Time of the accident", "time", { required: true }),
              f("place", fr ? "Lieu de l’accident" : "Place of the accident", "text", { required: true }),
              f("activity", fr ? "Activité de la victime lors de l’accident" : "Victim’s activity at the time", "text"),
              f("nature", fr ? "Nature de l’accident" : "Nature of the accident", "text"),
              f("damage", fr ? "Dommages à la victime suite à l’accident" : "Injuries to the victim", "longtext"),
              f("care", fr ? "Suite à l’accident, est-ce que la victime est allée à l’hôpital ou autre endroit pour recevoir des soins?" : "Did the victim go to a hospital or elsewhere for care?", "yesno", { required: true }),
              f("careWhere", fr ? "Si répondu oui à la question précédente, où est allée la victime?" : "If yes, where did the victim go?", "text"),
              f("careHow", fr ? "Si la victime est allée à un endroit pour recevoir des soins, comment y est-elle allée?" : "If the victim went somewhere for care, how did they get there?", "text"),
              f("returned", fr ? "Suite à l’accident de travail, est-ce que la victime est retournée au travail?" : "Did the victim return to work after the accident?", "yesno"),
            ],
          },
        ],
      },
    },
  ];
}

export const FIELD_TYPES: FieldType[] = ["text", "longtext", "date", "time", "number", "yesno", "select"];

/** One empty row of answers for a section. */
export const blankRow = (section: FormSection, today: string): Record<string, string> =>
  Object.fromEntries(section.fields.map((fl) => [fl.id, fl.type === "date" && fl.id === "date" ? today : ""]));

export const blankData = (def: FormDef, today: string): FormData => Object.fromEntries(def.sections.map((s) => [s.id, [blankRow(s, today)]]));

/** Labels of the required answers that are still empty. */
export function missingRequired(def: FormDef, data: FormData): string[] {
  const out: string[] = [];
  for (const s of def.sections) {
    (data[s.id] ?? []).forEach((row, i) => {
      for (const fl of s.fields) {
        if (fl.required && !(row[fl.id] ?? "").trim()) out.push(s.repeat && (data[s.id]?.length ?? 0) > 1 ? `${fl.label} (${i + 1})` : fl.label);
      }
    });
  }
  return out;
}

/** Answer shown for a field: Yes/No and similar are kept as typed. */
export const answerOf = (row: Record<string, string> | undefined, fl: FormField) => (row?.[fl.id] ?? "").trim();

export const parseDef = (raw: string): FormDef => {
  try {
    const parsed = JSON.parse(raw) as FormDef;
    return parsed && Array.isArray(parsed.sections) ? parsed : { sections: [] };
  } catch {
    return { sections: [] };
  }
};

export const parseData = (raw: string): FormData => {
  try {
    return JSON.parse(raw) as FormData;
  } catch {
    return {};
  }
};

export async function loadCustomTemplates(): Promise<FormTemplate[]> {
  await dbReady;
  const rows = await db.select().from(schema.form_templates).orderBy(desc(schema.form_templates.id));
  return rows.map((r) => ({ key: `custom:${r.id}`, id: r.id, name: r.name, description: r.description ?? "", def: parseDef(r.definition), builtin: false }));
}

export async function saveCustomTemplate(input: { id?: number; name: string; description: string; def: FormDef; userId: number | null }) {
  await dbReady;
  const values = { name: input.name.trim(), description: input.description.trim() || null, definition: JSON.stringify(input.def) };
  if (input.id) await db.update(schema.form_templates).set(values).where(eq(schema.form_templates.id, input.id));
  else await db.insert(schema.form_templates).values({ ...values, created_by: input.userId });
}

export async function deleteCustomTemplate(id: number) {
  await db.delete(schema.form_templates).where(eq(schema.form_templates.id, id));
}
