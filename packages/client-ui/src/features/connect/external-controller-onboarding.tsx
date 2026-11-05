import {
  createControllerId,
  normalizeControllerURL,
  type Controller,
} from "@xbond/client/controller";
import { Client } from "@xbond/client/request";
import { AlertCircle, Globe, HelpCircle, Server, Zap } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
        "mx-auto flex w-full max-w-xl flex-col gap-6 py-6",
        className,
      )}
    >
      {/* Header */}
      <div className="flex flex-col items-center text-center px-4">
        <Badge
          variant="secondary"
          className="mb-3 gap-1.5 bg-brand/10 text-brand-text border-0 font-medium text-xs px-3 py-1"
        >
          <Globe className="size-3.5" />
          <span>{t("webModeBadge")}</span>
        </Badge>
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t("webModeTitle")}
        </h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground leading-relaxed">
          {t("webModeDesc")}
        </p>
      </div>

      {/* Main Connection Card */}
      <Card className="rounded-card border border-border/80 bg-card/95 p-6 shadow-elevation-card">
        <form onSubmit={handleConnect} className="flex flex-col gap-4">
          {/* Controller URL */}
          <Field className="gap-1.5">
            <FieldLabel className="text-xs font-semibold text-foreground">
              {s("external.url")} <span className="text-destructive">*</span>
            </FieldLabel>
            <Input
              value={url}
              onChange={(e) => setURL(e.target.value)}
              placeholder="http://127.0.0.1:9090"
              className="font-mono text-sm"
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
                className="cursor-pointer rounded-full border border-border bg-inset px-2 py-0.5 text-[11px] font-mono text-muted-foreground transition-colors hover:border-brand hover:text-foreground"
              >
                127.0.0.1:9090
              </button>
              <button
                type="button"
                onClick={() => setURL("http://localhost:9090")}
                className="cursor-pointer rounded-full border border-border bg-inset px-2 py-0.5 text-[11px] font-mono text-muted-foreground transition-colors hover:border-brand hover:text-foreground"
              >
                localhost:9090
              </button>
              {typeof window !== "undefined" &&
                window.location.origin !== "http://127.0.0.1:9090" && (
                  <button
                    type="button"
                    onClick={() => setURL(window.location.origin)}
                    className="cursor-pointer rounded-full border border-border bg-inset px-2 py-0.5 text-[11px] font-mono text-muted-foreground transition-colors hover:border-brand hover:text-foreground"
                  >
                    {t("quickFillOrigin")}
                  </button>
                )}
            </div>
          </Field>

          {/* Secret / Key */}
          <Field className="gap-1.5">
            <FieldLabel className="text-xs font-semibold text-foreground">
              {s("external.secret")}
            </FieldLabel>
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={t("secretPlaceholder")}
              className="font-mono text-sm"
              disabled={pending}
            />
          </Field>

          {/* Name (Optional) */}
          <Field className="gap-1.5">
            <FieldLabel className="text-xs font-semibold text-foreground">
              {s("external.name")}
            </FieldLabel>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              className="text-sm"
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
            disabled={pending || !url.trim()}
            className="mt-2 w-full bg-brand text-brand-foreground hover:bg-brand-strong font-medium"
          >
            {pending ? (
              <>
                <Spinner className="mr-2 size-4" />
                <span>{s("external.connecting")}</span>
              </>
            ) : (
              <>
                <Zap className="mr-2 size-4" />
                <span>{t("connectAndSave")}</span>
              </>
            )}
          </Button>
        </form>
      </Card>

      {/* Saved Controllers (if any) */}
      {savedList.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
            {t("savedControllers")}
          </h4>
          <div className="flex flex-col gap-2">
            {savedList.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-card border border-border/70 bg-card p-3 shadow-xs transition-colors hover:border-brand/60"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-control bg-surface-inset text-muted-foreground">
                    <Server className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {item.name}
                    </p>
                    <p className="text-xs font-mono text-muted-foreground truncate">
                      {item.url}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleSelectSaved(item)}
                  className="shrink-0 ml-3"
                >
                  {t("switchController")}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Troubleshooting Tips */}
      <div className="rounded-card border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground">
        <div
          className="flex cursor-pointer items-center justify-between font-medium text-foreground select-none"
          onClick={() => setShowHelp(!showHelp)}
        >
          <span className="flex items-center gap-1.5">
            <HelpCircle className="size-4 text-brand-text" />
            <span>{s("external.helpTrigger")}</span>
          </span>
          <span className="text-[11px] text-muted-foreground hover:text-foreground">
            {showHelp ? t("collapse") : t("expand")}
          </span>
        </div>
        {showHelp && (
          <div className="mt-3 flex flex-col gap-2 border-t border-border/40 pt-3 text-[11px] leading-relaxed">
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
  );
}
