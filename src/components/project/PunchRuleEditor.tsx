import { useEffect, useState } from "react";
import { Crosshair, ExternalLink, Loader2, MapPin, MapPinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PunchRuleBanner } from "@/components/PunchRule";
import { useI18n } from "@/lib/i18n";
import { getCurrentPosition, locationFailure, parseCoordinate } from "@/lib/timeclock";
import type { MessageKey } from "@/lib/i18n/en";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

export type PunchRule = {
  geo_lat: number | null;
  geo_lng: number | null;
  geo_radius_m: number | null;
  require_geofence: number;
};

const RADIUS_PRESETS = [100, 200, 300, 500];

export const PUNCH_RULE_ANCHOR = "punch-rule";

export function PunchRuleEditor({ project, onSave }: { project: Project; onSave: (next: PunchRule) => Promise<void> }) {
  const { t } = useI18n();
  const [onSite, setOnSite] = useState(project.require_geofence === 1);
  const [lat, setLat] = useState(project.geo_lat != null ? String(project.geo_lat) : "");
  const [lng, setLng] = useState(project.geo_lng != null ? String(project.geo_lng) : "");
  const [radius, setRadius] = useState(String(project.geo_radius_m ?? 200));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    setOnSite(project.require_geofence === 1);
    setLat(project.geo_lat != null ? String(project.geo_lat) : "");
    setLng(project.geo_lng != null ? String(project.geo_lng) : "");
    setRadius(String(project.geo_radius_m ?? 200));
  }, [project.id, project.require_geofence, project.geo_lat, project.geo_lng, project.geo_radius_m]);

  const latNum = parseCoordinate(lat, 90);
  const lngNum = parseCoordinate(lng, 180);
  const radiusNum = Math.round(Number(radius.replace(",", ".")));
  const radiusOk = Number.isFinite(radiusNum) && radiusNum >= 25 && radiusNum <= 5000;
  const pinTyped = lat.trim() !== "" || lng.trim() !== "";
  const pinValid = latNum !== null && lngNum !== null;
  const canSave = !onSite || (pinValid && radiusOk);

  const draft: Project = {
    ...project,
    require_geofence: onSite ? 1 : 0,
    geo_lat: latNum,
    geo_lng: lngNum,
    geo_radius_m: radiusOk ? radiusNum : 200,
  };

  async function useMyLocation() {
    setLocating(true);
    setMessage(null);
    try {
      const pos = await getCurrentPosition();
      setLat(pos.coords.latitude.toFixed(6));
      setLng(pos.coords.longitude.toFixed(6));
      setMessage({ tone: "ok", text: t("punch.geo.located", { accuracy: String(Math.round(pos.coords.accuracy ?? 0)) }) });
    } catch (err) {
      const code = locationFailure(err).code;
      setMessage({ tone: "error", text: t(`${code}.body` as MessageKey) });
    } finally {
      setLocating(false);
    }
  }

  async function save() {
    if (!canSave) {
      setMessage({ tone: "error", text: pinTyped ? t("punch.geo.invalid") : t("punch.geo.pinMissing") });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await onSave({
        require_geofence: onSite ? 1 : 0,
        geo_lat: latNum,
        geo_lng: lngNum,
        geo_radius_m: radiusOk ? radiusNum : 200,
      });
      setMessage({ tone: "ok", text: t("punch.geo.saved") });
    } catch {
      setMessage({ tone: "error", text: t("punch.error.failed.body") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card id={PUNCH_RULE_ANCHOR} className="scroll-mt-24 gap-5 p-6">
      <div>
        <p className="frx-label flex items-center gap-2 text-muted-foreground">
          <span className="inline-block size-2 bg-primary" aria-hidden />
          {t("punch.title")}
        </p>
        <h2 className="mt-1.5 font-display text-2xl font-bold">{t("punch.geo.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("punch.geo.desc")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("punch.geo.title")}>
        {(
          [
            [false, MapPinOff, "punch.rule.anywhere", "punch.rule.anywhereDesc"],
            [true, MapPin, "punch.rule.required", "punch.geo.radiusHint"],
          ] as const
        ).map(([value, Icon, title, desc]) => {
          const active = onSite === value;
          return (
            <button
              key={String(value)}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setOnSite(value)}
              className={cn(
                "flex items-start gap-3 rounded-md border-2 p-4 text-left transition-colors",
                active ? "border-primary bg-primary/10" : "border-border hover:border-foreground/30",
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-sm",
                  active ? "bg-primary text-black" : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="size-[18px]" />
              </span>
              <span>
                <span className="block font-semibold">{t(title)}</span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">
                  {value ? t("punch.rule.requiredDesc", { meters: String(radiusOk ? radiusNum : 200) }) : t(desc)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {onSite ? (
        <div className="space-y-4 rounded-md border bg-muted/30 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="geo-lat">{t("punch.geo.lat")}</Label>
              <Input
                id="geo-lat"
                inputMode="decimal"
                placeholder="45.5017"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                aria-invalid={lat.trim() !== "" && latNum === null}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="geo-lng">{t("punch.geo.lng")}</Label>
              <Input
                id="geo-lng"
                inputMode="decimal"
                placeholder="-73.5673"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                aria-invalid={lng.trim() !== "" && lngNum === null}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={locating} onClick={() => void useMyLocation()}>
              {locating ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
              {locating ? t("punch.geo.locating") : t("punch.geo.useHere")}
            </Button>
            {pinValid ? (
              <Button type="button" variant="ghost" size="sm" asChild>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${latNum}&mlon=${lngNum}#map=17/${latNum}/${lngNum}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <ExternalLink className="size-4" />
                  {t("punch.geo.openMap")}
                </a>
              </Button>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="geo-radius">{t("punch.geo.radius")}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="geo-radius"
                inputMode="numeric"
                className="w-28"
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                aria-invalid={!radiusOk}
              />
              {RADIUS_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setRadius(String(preset))}
                  className={cn(
                    "frx-label h-9 rounded-sm border px-3 text-[10px] transition-colors",
                    radiusNum === preset ? "border-primary bg-primary text-black" : "bg-card hover:border-foreground/30",
                  )}
                >
                  {preset} m
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <PunchRuleBanner project={draft} />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={saving || !canSave} onClick={() => void save()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          {saving ? t("clients.saving") : t("punch.geo.save")}
        </Button>
        {!canSave && onSite ? (
          <p className="text-sm text-destructive">{pinTyped ? t("punch.geo.invalid") : t("punch.geo.pinMissing")}</p>
        ) : null}
        {message ? (
          <p className={cn("text-sm", message.tone === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")}>
            {message.text}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
