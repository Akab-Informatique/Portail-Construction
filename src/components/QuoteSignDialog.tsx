import { useEffect, useState } from "react";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SignaturePad } from "@/components/SignaturePad";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export function QuoteSignDialog({
  quote,
  companyName,
  defaultName,
  busy,
  onCancel,
  onSubmit,
}: {
  quote: { id: number; number: string; title: string; amount: number } | null;
  companyName: string;
  defaultName: string;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (input: { signerName: string; signature: string }) => void;
}) {
  const { t, locale } = useI18n();
  const [name, setName] = useState(defaultName);
  const [signature, setSignature] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(defaultName);
    setSignature("");
    setConfirmed(false);
    setError(null);
  }, [quote?.id, defaultName]);

  function submit() {
    const signerName = name.trim();
    if (!signerName) {
      setError(t("billing.sign.needName"));
      return;
    }
    if (!signature) {
      setError(t("billing.sign.needDraw"));
      return;
    }
    if (!confirmed) {
      setError(t("billing.sign.needConfirm"));
      return;
    }
    onSubmit({ signerName, signature });
  }

  return (
    <Dialog open={Boolean(quote)} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="size-4" />
            {t("billing.sign.title")}
          </DialogTitle>
        </DialogHeader>
        {quote ? (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              {t("billing.sign.desc", { number: quote.number })}
            </p>
            <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-sm">
              <p className="font-medium">{quote.title}</p>
              <p className="mt-0.5 tabular-nums text-muted-foreground">
                {quote.number} · {money(quote.amount, locale)}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quote-signer">{t("billing.sign.name")}</Label>
              <Input
                id="quote-signer"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("billing.sign.namePlaceholder")}
                autoComplete="name"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>{t("billing.sign.draw")}</Label>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSignature("")}>
                  {t("billing.sign.clear")}
                </Button>
              </div>
              <SignaturePad
                value={signature}
                onChange={setSignature}
                label={t("billing.sign.draw")}
              />
            </div>
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(v) => setConfirmed(v === true)}
                className="mt-0.5"
              />
              <span>{t("billing.sign.confirm", { company: companyName })}</span>
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {t("clients.cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={busy || !quote}>
            {t("billing.sign.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
