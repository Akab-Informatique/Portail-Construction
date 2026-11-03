import { BookOpen, Printer } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Block = { title: string; text?: string[]; bullets?: string[]; note?: string };

const GUIDE: Record<"en" | "fr", Block[]> = {
  en: [
    {
      title: "1. The golden rule",
      text: ["Nobody can see or do anything until an administrator gives it. Administrators are the only ones who have everything by default.", "Rights are always given in the Access page. There is no other place to set them: the Documentation page and the project pages show the same rights."],
    },
    {
      title: "2. Who is who",
      bullets: [
        "Administrator: sees and does everything. Nothing to set.",
        "Staff (employee): has the full portal menu, but only the pages, projects and folders you give.",
        "Client company: a customer of FRX. It owns its projects and its documentation level.",
        "Client user: a person of a client company. Never sees more than their company, and never sees staff pages.",
      ],
    },
    {
      title: "3. The four things you give",
      bullets: [
        "Menu and actions (staff only): which sidebar pages and which project modules, and for each: see, create, change, delete.",
        "Projects: which projects the person can open. For staff you can tick a whole company at once.",
        "Documentation: a level on each SharePoint folder: None, View, View + upload, Full.",
        "Reports (staff only): which reports the person may generate.",
      ],
    },
    {
      title: "4. Documentation levels",
      bullets: [
        "None: the folder does not exist for them.",
        "View: look only. No download, no print, no change.",
        "View + upload: look and add files, but no download and no change.",
        "Full: view, download, print, change, delete.",
        "A folder with nothing set takes the level of the folder above it. Set a level on a subfolder to open or close it on its own.",
      ],
      note: "A client user can never have more than their company on a folder.",
    },
    {
      title: "5. Groups: give once, apply to many",
      text: ["A group bundles menu rights, projects, folder levels and reports. Everyone in the group receives all of it.", "A person's access is what you gave them personally plus what their groups give. When two overlap, the widest wins. Removing someone from a group removes only what the group gave."],
    },
    {
      title: "6. What a client sees",
      text: ["A client always has the same short menu: Dashboard, Documentation, Projects, Invoices and quotes. Notebook, Calendar, Reports, Time on site, Finance, Administration and Setup are never shown to a client, and the pages are closed to them even if the address is typed by hand. The database itself also refuses any staff-only data.", "What the client finds inside is decided only by the projects and the folder levels you gave them or their group."],
    },
    {
      title: "7. Typical recipes",
      bullets: [
        "New employee: Access › Staff › New staff member. Tick their group, their projects, a level on the library, and send the invitation.",
        "New client: Access › Clients › New client. Set the company's level, tick “create the contact's account”, choose their group and send the invitation.",
        "A team that always gets the same things: Access › Staff rights › Groups › New group. Set menu, projects, folders and reports once, then add the people.",
        "Someone leaves a project: Access › rights › their name › Projects › untick it.",
      ],
    },
    {
      title: "8. Check before you trust",
      text: ["Open a person in Staff rights or Client rights and look at the Summary tab. It shows the sidebar they will really see, how many projects, their documentation level and their reports, computed from the same rules the portal uses."],
    },
  ],
  fr: [
    {
      title: "1. La règle d’or",
      text: ["Personne ne voit ni ne fait rien tant qu’un administrateur ne l’a pas donné. Les administrateurs sont les seuls à tout avoir par défaut.", "Les droits se donnent toujours dans la page Accès. Il n’y a aucun autre endroit : la page Documentation et les pages de projet montrent les mêmes droits."],
    },
    {
      title: "2. Qui est qui",
      bullets: [
        "Administrateur : voit et fait tout. Rien à régler.",
        "Employé : a le menu complet du portail, mais seulement les pages, projets et dossiers que vous lui donnez.",
        "Entreprise cliente : un client de FRX. Elle possède ses projets et son niveau de documentation.",
        "Utilisateur client : une personne d’une entreprise cliente. Ne voit jamais plus que son entreprise et jamais les pages des employés.",
      ],
    },
    {
      title: "3. Les quatre choses que vous donnez",
      bullets: [
        "Menu et actions (employés) : quelles pages du menu et quels modules de projet, et pour chacun : voir, créer, modifier, supprimer.",
        "Projets : quels projets la personne peut ouvrir. Pour un employé, vous pouvez cocher toute une entreprise d’un coup.",
        "Documentation : un niveau sur chaque dossier SharePoint : Aucun, Voir, Voir + téléverser, Complet.",
        "Rapports (employés) : quels rapports la personne peut générer.",
      ],
    },
    {
      title: "4. Les niveaux de documentation",
      bullets: [
        "Aucun : le dossier n’existe pas pour la personne.",
        "Voir : lecture seule. Ni téléchargement, ni impression, ni modification.",
        "Voir + téléverser : on regarde et on ajoute des fichiers, sans télécharger ni modifier.",
        "Complet : voir, télécharger, imprimer, modifier, supprimer.",
        "Un dossier sans réglage prend le niveau du dossier au-dessus. Réglez un sous-dossier pour l’ouvrir ou le fermer seul.",
      ],
      note: "Un utilisateur client n’a jamais plus que son entreprise sur un dossier.",
    },
    {
      title: "5. Les groupes : donner une fois, appliquer à plusieurs",
      text: ["Un groupe réunit des droits de menu, des projets, des niveaux de dossiers et des rapports. Toute personne du groupe reçoit le tout.", "L’accès d’une personne est ce que vous lui avez donné personnellement plus ce que ses groupes donnent. Quand deux réglages se chevauchent, le plus large gagne. Retirer quelqu’un d’un groupe retire seulement ce que le groupe donnait."],
    },
    {
      title: "6. Ce que voit un client",
      text: ["Un client a toujours le même court menu : Tableau de bord, Documentation, Projets, Factures et soumissions. Bloc-notes, Calendrier, Rapports, Temps sur chantier, Finances, Administration et Configuration ne lui sont jamais montrés, et ces pages leur sont fermées même si l’adresse est tapée à la main. La base de données refuse aussi toute donnée réservée aux employés.", "Ce que le client y trouve dépend seulement des projets et des niveaux de dossiers que vous lui avez donnés, à lui ou à son groupe."],
    },
    {
      title: "7. Recettes courantes",
      bullets: [
        "Nouvel employé : Accès › Employés › Nouvel employé. Cochez son groupe, ses projets, un niveau sur la bibliothèque, et envoyez l’invitation.",
        "Nouveau client : Accès › Clients › Nouveau client. Réglez le niveau de l’entreprise, cochez « créer le compte du contact », choisissez son groupe et envoyez l’invitation.",
        "Une équipe qui reçoit toujours la même chose : Accès › Droits employés › Groupes › Nouveau groupe. Réglez menu, projets, dossiers et rapports une fois, puis ajoutez les personnes.",
        "Quelqu’un quitte un projet : Accès › droits › son nom › Projets › décochez-le.",
      ],
    },
    {
      title: "8. Vérifier avant de faire confiance",
      text: ["Ouvrez une personne dans Droits employés ou Droits clients et regardez l’onglet Résumé. Il montre le menu qu’elle verra vraiment, le nombre de projets, son niveau de documentation et ses rapports, calculés avec les mêmes règles que le portail."],
    },
  ],
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** The guide as a printable page in the FRX look; the browser's print dialog saves it as a PDF. */
function printGuide(title: string, subtitle: string, blocks: Block[]) {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return;
  const body = blocks
    .map(
      (b) => `<section><h2>${esc(b.title)}</h2>${(b.text ?? []).map((p) => `<p>${esc(p)}</p>`).join("")}${b.bullets ? `<ul>${b.bullets.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${b.note ? `<div class="note">${esc(b.note)}</div>` : ""}</section>`,
    )
    .join("");
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: Letter; margin: 16mm; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #1c1c1c; line-height: 1.5; font-size: 12.5px; margin: 0; }
    header { background: #141414; color: #fff; padding: 22px 26px; border-bottom: 5px solid #fbaa19; display: flex; align-items: center; justify-content: space-between; }
    header img { height: 38px; }
    header h1 { margin: 0; font-size: 22px; letter-spacing: .06em; text-transform: uppercase; }
    header p { margin: 2px 0 0; color: #fbaa19; font-size: 12px; }
    main { padding: 18px 26px; }
    section { break-inside: avoid; margin: 0 0 14px; padding: 12px 16px; border: 1px solid #e4e4e4; border-left: 4px solid #fbaa19; border-radius: 6px; }
    h2 { margin: 0 0 6px; font-size: 14px; text-transform: uppercase; letter-spacing: .05em; }
    p { margin: 0 0 6px; } ul { margin: 0; padding-left: 18px; } li { margin: 2px 0; }
    .note { margin-top: 8px; padding: 6px 10px; background: #fff4d9; border-radius: 4px; font-weight: 600; }
    footer { text-align: center; color: #777; font-size: 10px; padding: 8px; }
    @media print { header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .note { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style></head><body><header><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><img src="${location.origin}/brand/frx-logo-white.png" alt="FRX Construction"></header><main>${body}</main><footer>FRX Construction · Portail / Portal</footer><script>window.onload=function(){setTimeout(function(){window.print()},400)}</script></body></html>`);
  win.document.close();
}

/** The access-rights guide: a button that opens an in-app guide, with a branded PDF/print version. */
export function AccessGuide({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, locale } = useI18n();
  const blocks = GUIDE[locale === "fr" ? "fr" : "en"];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <div className="-mx-6 -mt-6 mb-2 flex items-center justify-between gap-4 rounded-t-lg border-b-4 border-primary bg-[#141414] px-6 py-5 text-white">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 font-display text-2xl uppercase tracking-wide text-white">
              <BookOpen className="size-5 text-primary" />
              {t("adm.guide.title")}
            </DialogTitle>
            <DialogDescription className="text-primary">{t("adm.guide.subtitle")}</DialogDescription>
          </DialogHeader>
          <Logo inverted className="hidden h-9 sm:block" />
        </div>
        <div className="grid gap-3">
          {blocks.map((b) => (
            <section key={b.title} className="rounded-lg border border-l-4 border-l-primary bg-card p-4">
              <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide">{b.title}</h3>
              {b.text?.map((p) => (
                <p key={p} className="mb-1.5 text-sm text-muted-foreground">
                  {p}
                </p>
              ))}
              {b.bullets ? (
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {b.bullets.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              ) : null}
              {b.note ? <p className="mt-2 rounded bg-primary/15 px-3 py-1.5 text-sm font-medium">{b.note}</p> : null}
            </section>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("adm.guide.close")}
          </Button>
          <Button onClick={() => printGuide(t("adm.guide.title"), t("adm.guide.subtitle"), blocks)}>
            <Printer className="size-4" />
            {t("adm.guide.print")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
