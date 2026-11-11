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
    // 只切換目標，不驗證連通：「連接成功」必須來自真實測試（test 按鈕），
    // 未驗證就報成功違反狀態如實原則；切換本身在介面上已可見。
    select({ kind: "controller", id: controller.id });
  }

  return (
    <div
      className={cn("mx-auto w-full max-w-[1120px] py-4 md:py-6", className)}
    >
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-5 xl:grid-cols-12">
        <section className="bento bento-hero relative flex flex-col items-start justify-center overflow-hidden rounded-hero p-6 lg:p-8 xl:col-span-7 xl:p-10">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -end-24 -top-28 size-64 rounded-full"
            style={{
              background:
                "radial-gradient(circle, color-mix(in oklab, var(--brand) 14%, transparent), transparent 68%)",
            }}
          />
          <div className="relative mb-6 flex items-center gap-2.5">
            <span className="grid size-10 place-items-center rounded-lg border border-[var(--glass-border)] bg-white/45 text-brand-text dark:bg-white/10">
              <Globe
                aria-hidden="true"
                className="size-[18px]"
                strokeWidth={1.7}
              />
            </span>
            <span className="text-caption font-semibold tracking-[0.02em] text-brand-text">
              {t("webModeBadge")}
            </span>
          </div>
          <h2 className="relative max-w-[28rem] text-headline font-semibold leading-[1.08] tracking-[-0.04em] text-foreground xl:text-display">
            {t("webModeTitle")}
          </h2>
          <p className="relative mt-5 max-w-[28rem] text-label leading-6 text-muted-foreground">
            {t("webModeDesc")}
          </p>
        </section>

        <div className="flex min-w-0 flex-col gap-4 lg:gap-5 xl:col-span-5">
          {/* Main Connection Card */}
          <Card className="p-6 shadow-elevation-raised sm:p-7">
            <form onSubmit={handleConnect} className="flex flex-col gap-4">
              {/* Controller URL */}
              <Field className="gap-1.5">
                <FieldLabel className="text-caption font-semibold text-foreground">
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
                  <span className="text-caption text-muted-foreground">
                    {t("quickFill")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setURL("http://127.0.0.1:9090")}
                    className="cursor-pointer rounded-[4px] border border-transparent px-1.5 py-0.5 font-mono text-caption max-md:min-h-11 font-medium text-brand-text transition-colors hover:border-brand/30 hover:bg-brand-soft"
                  >
                    127.0.0.1:9090
                  </button>
                  <button
                    type="button"
                    onClick={() => setURL("http://localhost:9090")}
                    className="cursor-pointer rounded-[4px] border border-transparent px-1.5 py-0.5 font-mono text-caption max-md:min-h-11 font-medium text-brand-text transition-colors hover:border-brand/30 hover:bg-brand-soft"
                  >
                    localhost:9090
                  </button>
                  {typeof window !== "undefined" &&
                    window.location.origin !== "http://127.0.0.1:9090" && (
                      <button
                        type="button"
                        onClick={() => setURL(window.location.origin)}
                        className="cursor-pointer rounded-[4px] border border-transparent px-1.5 py-0.5 font-mono text-caption max-md:min-h-11 font-medium text-brand-text transition-colors hover:border-brand/30 hover:bg-brand-soft"
                      >
                        {t("quickFillOrigin")}
                      </button>
                    )}
                </div>
              </Field>

              {/* Secret / Key */}
              <Field className="gap-1.5">
                <FieldLabel className="text-caption font-semibold text-foreground">
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
                <FieldLabel className="text-caption font-semibold text-foreground">
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
                <Alert
                  variant="destructive"
                  className="mt-1 animate-in fade-in-50 slide-in-from-top-1 duration-200"
                >
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
            <div className="bento overflow-hidden rounded-card">
              <h4 className="border-b border-[var(--glass-border)] px-4 py-2.5 text-caption font-semibold text-muted-foreground">
                {t("savedControllers")}
              </h4>
              <div className="divide-y divide-[var(--glass-border)]">
                {savedList.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-white/40 dark:hover:bg-white/10"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-control bg-inset text-muted-foreground">
                        <Server className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-label font-medium text-foreground">
                          {item.name}
                        </p>
                        <p className="truncate font-mono text-caption text-muted-foreground">
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
          <div className="bento rounded-card p-4 text-caption leading-5 text-muted-foreground">
            <button
              type="button"
              className="flex min-h-11 w-full cursor-pointer items-center justify-between py-1 text-left text-caption font-medium text-foreground"
              aria-expanded={showHelp}
              onClick={() => setShowHelp(!showHelp)}
            >
              <span className="flex items-center gap-1.5">
                <HelpCircle className="size-4 text-brand-text" />
                <span>{s("external.helpTrigger")}</span>
              </span>
              <span className="text-caption text-brand-text underline underline-offset-2 hover:text-brand-strong">
                {showHelp ? t("collapse") : t("expand")}
              </span>
            </button>
            {showHelp && (
              <div className="mt-3 flex animate-in flex-col gap-2 border-t border-border pt-3 text-caption leading-5 fade-in-50 slide-in-from-top-1 duration-200">
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
    </div>
  );
}
