import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Section = { title: string; body: string[] };

const UPDATED = "2026-11-25";

const CONTENT: Record<"fr" | "en", { title: string; intro: string; back: string; updated: string; sections: Section[] }> = {
  fr: {
    title: "Politique de confidentialité — renseignements personnels",
    intro:
      "Cette page explique, conformément à la Loi sur la protection des renseignements personnels dans le secteur privé du Québec (modernisée par la Loi 25), comment Construction FRX inc. (« FRX ») traite les renseignements personnels recueillis sur ce portail.",
    back: "Retour",
    updated: "Dernière mise à jour",
    sections: [
      {
        title: "À quoi sert ce portail",
        body: ["Le portail sert uniquement à suivre vos projets avec FRX : consulter l’échéancier, les documents, les notes, les photos, les soumissions et les factures, poser des questions et accepter des soumissions."],
      },
      {
        title: "Les renseignements que nous recueillons",
        body: [
          "Vos coordonnées : nom, courriel, téléphone, entreprise et fonction.",
          "Les renseignements liés à votre projet : documents, notes, messages, questions, soumissions et factures.",
          "Lorsque vous acceptez une soumission : votre signature, la date et l’heure de l’acceptation et l’adresse IP de l’appareil utilisé. L’adresse IP est conservée à titre de référence seulement, comme preuve de l’acceptation.",
          "Vos connexions au portail : la date et l’heure de votre dernière connexion et l’état de votre compte, pour assurer la sécurité de l’accès.",
        ],
      },
      {
        title: "Comment ils sont utilisés",
        body: [
          "Tous les renseignements recueillis servent uniquement au suivi de votre projet, à la qualité du travail et au service que nous vous offrons.",
          "Ils sont confidentiels : seuls vous (et les personnes de votre entreprise que vous avez autorisées) et l’équipe de FRX y ont accès. Chaque utilisateur ne voit que les projets auxquels il a été ajouté.",
        ],
      },
      {
        title: "Aucune vente, aucun partage commercial",
        body: [
          "FRX ne vend pas vos renseignements et ne les communique pas à des tiers à des fins commerciales ou publicitaires.",
          "Seuls des fournisseurs techniques, qui agissent pour nous et uniquement pour faire fonctionner le service (hébergement, envoi de courriels et de messages texte), peuvent traiter les renseignements nécessaires à cet envoi.",
        ],
      },
      {
        title: "Conservation et sécurité",
        body: [
          "Les renseignements sont conservés le temps nécessaire au suivi du projet et au respect de nos obligations légales, puis détruits ou rendus anonymes.",
          "L’accès au portail est protégé par un compte personnel et des règles d’accès par projet. Nous prenons des mesures raisonnables pour protéger les renseignements contre l’accès non autorisé, la perte ou l’utilisation abusive.",
        ],
      },
      {
        title: "Vos droits",
        body: [
          "Vous pouvez en tout temps communiquer avec FRX Construction pour toute question sur vos renseignements personnels, pour y accéder, les faire corriger, retirer votre consentement ou demander que les renseignements vous concernant soient supprimés, dans la mesure permise par la loi.",
          "Nous répondons à votre demande dans un délai maximal de 30 jours.",
          "Pour toute plainte, vous pouvez aussi vous adresser à la Commission d’accès à l’information du Québec.",
        ],
      },
      {
        title: "Nous joindre",
        body: ["Appelez ou écrivez à Construction FRX inc., aux coordonnées indiquées sur vos soumissions et vos factures, en précisant que votre demande concerne vos renseignements personnels."],
      },
    ],
  },
  en: {
    title: "Privacy policy — personal information",
    intro:
      "In line with Quebec’s Act respecting the protection of personal information in the private sector (as modernized by Law 25), this page explains how Construction FRX inc. (“FRX”) handles the personal information collected on this portal.",
    back: "Back",
    updated: "Last updated",
    sections: [
      {
        title: "What this portal is for",
        body: ["The portal is used only to follow your projects with FRX: view the schedule, documents, notes, photos, quotes and invoices, ask questions and accept quotes."],
      },
      {
        title: "What we collect",
        body: [
          "Your contact details: name, email, phone, company and role.",
          "Information about your project: documents, notes, messages, questions, quotes and invoices.",
          "When you accept a quote: your signature, the date and time of acceptance and the IP address of the device used. The IP address is kept for reference only, as proof of acceptance.",
          "Your sign-ins: the date and time of your last sign-in and your account status, to keep access secure.",
        ],
      },
      {
        title: "How it is used",
        body: [
          "Everything we collect is used only to follow your project, to ensure the quality of the work and the service we give you.",
          "It is confidential: only you (and the people of your company you have authorized) and the FRX team can see it. Each user only sees the projects they were added to.",
        ],
      },
      {
        title: "No sale, no commercial sharing",
        body: [
          "FRX does not sell your information and does not give it to third parties for commercial or advertising purposes.",
          "Only technical providers acting for us, and only to run the service (hosting, sending emails and text messages), may process the information needed to deliver them.",
        ],
      },
      {
        title: "Retention and security",
        body: [
          "Information is kept as long as needed to follow the project and meet our legal obligations, then destroyed or made anonymous.",
          "Access to the portal is protected by a personal account and per-project access rules. We take reasonable measures to protect information against unauthorized access, loss or misuse.",
        ],
      },
      {
        title: "Your rights",
        body: [
          "You may contact FRX Construction at any time with any question about your personal information, to access it, have it corrected, withdraw your consent or ask that the information about you be deleted, to the extent the law allows.",
          "We answer your request within 30 days.",
          "You may also file a complaint with Quebec’s Commission d’accès à l’information.",
        ],
      },
      {
        title: "Contact us",
        body: ["Call or write to Construction FRX inc. using the details on your quotes and invoices, and say that your request concerns your personal information."],
      },
    ],
  },
};

/** Law 25 privacy policy: public (no sign-in), linked from the sign-in page and from the quote acceptance window. */
export function PrivacyPage() {
  const { locale, setLocale } = useI18n();
  const lang = locale === "en" ? "en" : "fr";
  const c = CONTENT[lang];
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-5">
        <Link to="/login" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          {c.back}
        </Link>
        <Logo />
        <div className="flex overflow-hidden rounded-md border text-xs font-semibold" role="group">
          {(["fr", "en"] as const).map((code) => (
            <button key={code} type="button" onClick={() => setLocale(code)} className={cn("px-2.5 py-1", lang === code ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 pb-16">
        <h1 className="font-display text-3xl leading-tight">{c.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{c.intro}</p>
        <div className="mt-8 space-y-7">
          {c.sections.map((s) => (
            <section key={s.title} className="space-y-2">
              <h2 className="font-display text-xl leading-none">{s.title}</h2>
              {s.body.length > 1 ? (
                <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
                  {s.body.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm leading-relaxed">{s.body[0]}</p>
              )}
            </section>
          ))}
        </div>
        <p className="mt-10 text-xs text-muted-foreground">
          {c.updated} : {UPDATED}
        </p>
      </main>
    </div>
  );
}
