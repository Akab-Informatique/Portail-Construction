import { useState } from "react";
import { Mail, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";

export type ComposeDraft = {
  to: string[];
  subject: string;
  body: string;
};

export function ComposeEmailDialog({
  open,
  draft,
  onChange,
  sending,
  onCancel,
  onSend,
}: {
  open: boolean;
  draft: ComposeDraft | null;
  onChange: (next: ComposeDraft) => void;
  sending: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  const { t } = useI18n();
  const [extra, setExtra] = useState("");

  if (!draft) return null;

  function addRecipient() {
    const email = extra.trim();
    if (!email || !draft) return;
    if (!draft.to.includes(email)) onChange({ ...draft, to: [...draft.to, email] });
    setExtra("");
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("mail.compose.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("mail.compose.hint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label>{t("mail.compose.to")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {draft.to.map((email) => (
                <span key={email} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-xs">
                  {email}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => onChange({ ...draft, to: draft.to.filter((item) => item !== email) })}
                    aria-label={t("mail.compose.remove")}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                type="email"
                value={extra}
                placeholder={t("mail.compose.addPlaceholder")}
                onChange={(e) => setExtra(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addRecipient();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addRecipient}>
                <Plus className="size-4" />
                {t("mail.compose.add")}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("mail.compose.subject")}</Label>
            <Input value={draft.subject} onChange={(e) => onChange({ ...draft, subject: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("mail.compose.body")}</Label>
            <Textarea
              rows={8}
              value={draft.body}
              onChange={(e) => onChange({ ...draft, body: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={sending}>
            {t("mail.compose.cancel")}
          </Button>
          <Button disabled={sending || draft.to.length === 0 || !draft.subject.trim()} onClick={onSend}>
            <Mail className="size-4" />
            {sending ? t("mail.compose.sending") : t("mail.compose.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
