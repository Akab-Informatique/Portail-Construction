import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PdfPages } from "@/components/PdfPages";
import { fileViewUrl, releaseViewUrl, setSignFields } from "@/lib/billing-files";
import { useI18n } from "@/lib/i18n";
import { parseSignFields, type SignField } from "@/lib/sign-fields";
import type { BillingFile } from "@/lib/types";

/** Staff place the red boxes where the client signs and dates the PDF of a quote. */
export function SignFieldsDialog({ file, onClose, onSaved }: { file: BillingFile | null; onClose: () => void; onSaved: (fields: SignField[]) => void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<SignField[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isPdf = (file?.file_type ?? "").includes("pdf");

  useEffect(() => {
    setFields(parseSignFields(file?.sign_fields));
    setError("");
    setUrl(null);
    if (!file || !isPdf) return;
    let alive = true;
    let made: string | null = null;
    fileViewUrl(file)
      .then((u) => {
        made = u;
        if (alive) setUrl(u);
        else releaseViewUrl(u);
      })
      .catch(() => alive && setError(t("billing.view.missing")));
    return () => {
      alive = false;
      releaseViewUrl(made);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  async function save() {
    if (!file) return;
    setBusy(true);
    try {
      await setSignFields(file, fields);
      onSaved(fields);
      onClose();
    } catch {
      setError(t("sf.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(file)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("sf.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("sf.desc")}</p>
        {!isPdf ? <p className="text-sm text-destructive">{t("sf.pdfOnly")}</p> : url ? <PdfPages url={url} fields={fields} mode="edit" onChange={setFields} /> : <p className="py-10 text-center text-sm text-muted-foreground">{error || t("billing.file.loading")}</p>}
        {error && url ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("clients.cancel")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy || !isPdf}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("sf.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
