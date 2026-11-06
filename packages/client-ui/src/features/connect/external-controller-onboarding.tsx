import {
  createControllerId,
  normalizeControllerURL,
  type Controller,
} from "@xbond/client/controller";
import { Client } from "@xbond/client/request";
import {
  AlertCircle,
  ArrowRight,
  Globe,
  HelpCircle,
  Server,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useExternals, useSelectTarget } from "@/state/controller-target";

interface ExternalControllerOnboardingProps {
  className?: string;
}

export function ExternalControllerOnboarding({
  className,
}: ExternalControllerOnboardingProps) {
  const { t } = useTranslation("onboarding");
  const { t: s } = useTranslation("settings");
  const [controllers, setControllers] = useExternals();
  const select = useSelectTarget();

  // Pure web default URL
  const defaultURL =
    typeof window !== "undefined" && window.location.pathname.startsWith("/ui")
      ? window.location.origin
      : "http://127.0.0.1:9090";

  const [url, setURL] = useState(defaultURL);
  const [secret, setSecret] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  // 已保存的外部控制器：列表本身只含外部條目，無需再過濾。
  const savedList = controllers;

  async function handleConnect(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (pending) return;

    setError("");
    let normalized = "";
    try {
      normalized = normalizeControllerURL(url.trim());
    } catch {
      setError(s("external.invalidURL"));
      return;
    }

    setPending(true);
    try {
      const client = Client.forController(normalized, secret.trim());
      const { data } = await client.getVersion();
      const versionStr = data.version ? ` (${data.version})` : "";

      const resolvedName = name.trim() || new URL(normalized).host || "Core";

      const existing = controllers.find((item) => item.url === normalized);
      let targetId = existing?.id;

      if (existing) {
        setControllers(
          controllers.map((item) =>
            item.id === existing.id
              ? { ...item, name: resolvedName, secret: secret.trim() }
              : item,
          ),
        );
      } else {
        targetId = createControllerId();
        const newController: Controller = {
          id: targetId,
          name: resolvedName,
          url: normalized,
          secret: secret.trim(),
        };
        setControllers([...controllers, newController]);
      }

      if (targetId) {
        select({ kind: "controller", id: targetId });
      }

      toast.success(`${s("external.testOK")}${versionStr}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) {
        setError(t("unauthorizedTip"));
      } else {
        setError(`${s("external.testFailed")} ${t("corsTip")}`);
      }
    } finally {
      setPending(false);
    }
  }

  function handleSelectSaved(controller: Controller) {
    select({ kind: "controller", id: controller.id });
    toast.success(`${s("external.testOK")}: ${controller.name}`);
  }

  return (
    <div
      className={cn(
        "mx-auto grid w-full max-w-[980px] items-start gap-10 py-10 md:grid-cols-[minmax(0,0.9fr)_minmax(0,420px)] md:gap-16 md:py-12",
        className,
      )}
    >
      <div className="flex flex-col items-start md:sticky md:top-10">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-control border border-border bg-card text-brand-text">
            <Globe
              aria-hidden="true"
              className="size-[18px]"
              strokeWidth={1.7}
            />
          </span>
          <span className="text-[11px] font-semibold tracking-[0.02em] text-brand-text">
            {t("webModeBadge")}
          </span>
        </div>
        <h2 className="max-w-[28rem] text-[34px] font-semibold leading-[1.12] tracking-[-0.035em] text-foreground sm:text-[40px]">
          {t("webModeTitle")}
        </h2>
        <p className="mt-4 max-w-[26rem] text-[13px] leading-6 text-muted-foreground">
          {t("webModeDesc")}
        </p>
        <div className="mt-8 grid w-full max-w-sm grid-cols-3 gap-px overflow-hidden rounded-card border border-border bg-border">
          {[s("external.url"), s("external.secret"), s("external.name")].map(
            (label, index) => (
              <div key={label} className="bg-card px-3 py-3.5">
                <span className="block font-mono text-[10px] text-brand-text">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="mt-1 block truncate text-[11px] font-medium text-muted-foreground">
                  {label}
                </span>
              </div>
            ),
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4 md:pt-14">
        {/* Main Connection Card */}
        <Card className="p-5 sm:p-6">
          <form onSubmit={handleConnect} className="flex flex-col gap-4">
            {/* Controller URL */}
            <Field className="gap-1.5">
              <FieldLabel className="text-[11px] font-semibold text-foreground">
                {s("external.url")} <span className="text-brand-text">*</span>
              </FieldLabel>
              <Input
                value={url}
                onChange={(e) => setURL(e.target.value)}
                placeholder="http://127.0.0.1:9090"
                className="font-mono"
                disabled={pending}
                required
              />
              {/* Quick Fill Tags */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] text-muted-foreground">
                  {t("quickFill")}
                </span>
                <button
                  type="button"
                  onClick={() => setURL("http://127.0.0.1:9090")}
                  className="cursor-pointer rounded-[3px] px-1 py-0.5 font-mono text-[10px] text-brand-text transition-colors hover:bg-brand-soft"
                >
                  127.0.0.1:9090
                </button>
                <button
                  type="button"
                  onClick={() => setURL("http://localhost:9090")}
                  className="cursor-pointer rounded-[3px] px-1 py-0.5 font-mono text-[10px] text-brand-text transition-colors hover:bg-brand-soft"
                >
                  localhost:9090
                </button>
                {typeof window !== "undefined" &&
                  window.location.origin !== "http://127.0.0.1:9090" && (
                    <button
                      type="button"
                      onClick={() => setURL(window.location.origin)}
                      className="cursor-pointer rounded-[3px] px-1 py-0.5 font-mono text-[10px] text-brand-text transition-colors hover:bg-brand-soft"
                    >
                      {t("quickFillOrigin")}
                    </button>
                  )}
              </div>
            </Field>

            {/* Secret / Key */}
            <Field className="gap-1.5">
              <FieldLabel className="text-[11px] font-semibold text-foreground">
                {s("external.secret")}
              </FieldLabel>
              <Input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={t("secretPlaceholder")}
                className="font-mono"
                disabled={pending}
              />
            </Field>

            {/* Name (Optional) */}
            <Field className="gap-1.5">
              <FieldLabel className="text-[11px] font-semibold text-foreground">
                {s("external.name")}
              </FieldLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                className=""
                disabled={pending}
              />
            </Field>

            {/* Error Alert */}
            {error && (
              <Alert variant="destructive" className="mt-1">
                <AlertCircle className="size-4 shrink-0" />
                <AlertDescription className="text-xs leading-relaxed">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              variant="brand"
              size="lg"
              disabled={pending || !url.trim()}
              className="mt-2 w-full"
            >
              {pending ? (
                <>
                  <Spinner className="mr-2 size-4" />
                  <span>{s("external.connecting")}</span>
                </>
              ) : (
                <>
                  <ArrowRight aria-hidden="true" className="mr-2 size-4" />
                  <span>{t("connectAndSave")}</span>
                </>
              )}
            </Button>
          </form>
        </Card>

        {/* Saved Controllers (if any) */}
        {savedList.length > 0 && (
          <div className="overflow-hidden rounded-card border border-border bg-card">
            <h4 className="border-b border-border px-4 py-2.5 text-[11px] font-semibold text-muted-foreground">
              {t("savedControllers")}
            </h4>
            <div className="divide-y divide-border">
              {savedList.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-row-hover"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-control bg-inset text-muted-foreground">
                      <Server className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-foreground">
                        {item.name}
                      </p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {item.url}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSelectSaved(item)}
                    className="shrink-0"
                  >
                    {t("switchController")}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Troubleshooting Tips */}
        <div className="rounded-card border border-border bg-card p-4 text-[11px] leading-5 text-muted-foreground">
          <button
            type="button"
            className="flex w-full cursor-pointer items-center justify-between text-left text-[12px] font-medium text-foreground"
            aria-expanded={showHelp}
            onClick={() => setShowHelp(!showHelp)}
          >
            <span className="flex items-center gap-1.5">
              <HelpCircle className="size-4 text-brand-text" />
              <span>{s("external.helpTrigger")}</span>
            </span>
            <span className="text-[11px] text-brand-text underline underline-offset-2 hover:text-brand-strong">
              {showHelp ? t("collapse") : t("expand")}
            </span>
          </button>
          {showHelp && (
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 text-[11px] leading-5">
              <p>
                1. <strong>{s("external.url")}</strong>: {s("external.note")}
              </p>
              <p>
                2. <strong>CORS</strong>: {t("corsTip")}
              </p>
              <p>3. {s("external.localNetworkNote")}</p>
              <p>
                4. {s("external.browserNote")} {s("external.allowInsecure")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
