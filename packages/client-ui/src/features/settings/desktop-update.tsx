import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { invokeDesktop } from "@/platform/local-api-bootstrap";

import {
  formatDownloadProgress,
  selectLocalizedReleaseNote,
} from "./update-progress";

type UpdateStatus = {
  enabled: boolean;
  status:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "installing"
    | "failed";
  version: string | null;
  notesByLocale?: Record<string, string>;
  received?: number;
  total?: number | null;
  daemonError: boolean;
  machineUpdateError: boolean;
  reconcilingDaemon: boolean;
};

export function DesktopUpdate() {
  const { t, i18n } = useTranslation("settings");
  const [update, setUpdate] = useState<UpdateStatus>();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const invoke = invokeDesktop();

  useEffect(() => {
    if (!invoke) return;
    let active = true;
    async function refresh() {
      try {
        const status = (await invoke?.(
          "desktop_update_status",
        )) as UpdateStatus;
        if (active) setUpdate(status);
      } catch {
        if (active) setFailed(true);
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 800);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [invoke]);

  if (!invoke) return null;

  const busy =
    pending ||
    update?.status === "checking" ||
    update?.status === "downloading" ||
    update?.status === "installing";
  const version = update?.status === "available" ? update.version : null;

  async function run(versionToInstall?: string) {
    if (busy) return;
    setFailed(false);
    setPending(true);
    try {
      if (versionToInstall) {
        await invoke?.("install_desktop_update", { version: versionToInstall });
      } else {
        await invoke?.("check_desktop_update");
      }
      setUpdate((await invoke?.("desktop_update_status")) as UpdateStatus);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  let message: string | undefined;
  if (failed || update?.status === "failed")
    message = t("desktopUpdate.failed");
  else if (update?.enabled === false) message = t("desktopUpdate.managed");
  else if (version) message = t("desktopUpdate.available", { version });
  else if (
    update &&
    update.status !== "idle" &&
    update.status !== "available"
  ) {
    message = t(`desktopUpdate.${update.status}`);
  }

  const progress =
    update?.status === "downloading"
      ? formatDownloadProgress(update.received, update.total)
      : null;
  const releaseNote =
    version && !failed
      ? selectLocalizedReleaseNote(update?.notesByLocale, i18n.language)
      : null;

  return (
    <section
      className="col-span-full flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border/60 bg-inset/50 px-4 py-3"
      aria-label={t("desktopUpdate.title")}
    >
      <div className="min-w-0 flex-1 basis-48 space-y-1.5">
        <h3 className="text-sm font-medium">{t("desktopUpdate.title")}</h3>
        <div role="status" className="text-xs text-muted-foreground">
          {message && (
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p>{message}</p>
              {progress?.label && (
                <span className="font-mono tabular-nums">{progress.label}</span>
              )}
            </div>
          )}
          {version && !failed && <p>{t("desktopUpdate.interruption")}</p>}
          {releaseNote && (
            <p className="mt-1.5 whitespace-pre-line text-muted-foreground/90">
              {releaseNote}
            </p>
          )}
          {update?.daemonError && <p>{t("desktopUpdate.daemonError")}</p>}
          {update?.machineUpdateError && (
            <p>{t("desktopUpdate.machineUpdateError")}</p>
          )}
        </div>
        {update?.status === "downloading" &&
          (progress?.percent !== null && progress?.percent !== undefined ? (
            <Progress
              aria-label={t("desktopUpdate.downloading")}
              value={progress.percent}
            />
          ) : (
            <div
              role="progressbar"
              aria-label={t("desktopUpdate.downloading")}
              aria-busy="true"
              className="relative h-2 w-full overflow-hidden rounded-full bg-inset"
            >
              <div className="h-full w-2/5 animate-pulse rounded-full bg-brand-strong" />
            </div>
          ))}
      </div>
      {update?.enabled && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void run()}
          >
            {t("desktopUpdate.check")}
          </Button>
          {version && !failed && (
            <Button
              size="sm"
              disabled={busy || update.reconcilingDaemon}
              onClick={() => void run(version)}
            >
              {t("desktopUpdate.install")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
