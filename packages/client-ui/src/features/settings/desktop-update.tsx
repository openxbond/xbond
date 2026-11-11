import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { invokeDesktop } from "@/platform/local-api-bootstrap";

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
  received?: number;
  total?: number | null;
  daemonError: boolean;
  machineUpdateError: boolean;
  reconcilingDaemon: boolean;
};

export function DesktopUpdate() {
  const { t } = useTranslation("settings");
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

  return (
    <section
      className="col-span-full flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border/60 bg-inset/50 px-4 py-3"
      aria-label={t("desktopUpdate.title")}
    >
      <div className="min-w-0 flex-1 basis-48 space-y-1">
        <h3 className="text-sm font-medium">{t("desktopUpdate.title")}</h3>
        <div role="status" className="text-xs text-muted-foreground">
          {message && <p>{message}</p>}
          {version && !failed && <p>{t("desktopUpdate.interruption")}</p>}
          {update?.daemonError && <p>{t("desktopUpdate.daemonError")}</p>}
          {update?.machineUpdateError && (
            <p>{t("desktopUpdate.machineUpdateError")}</p>
          )}
        </div>
        {update?.status === "downloading" && (
          <progress
            aria-label={t("desktopUpdate.downloading")}
            className="w-full accent-brand"
            max={update.total ?? undefined}
            value={update.total ? update.received : undefined}
          />
        )}
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
