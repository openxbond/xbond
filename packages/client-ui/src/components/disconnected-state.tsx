import { ArrowRight, Plus, Power, Settings2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useAPIInfo } from "@/state/controller-target";
import { useGeneral } from "@/state/core-settings";
import { useLocalAPI } from "@/state/local-runtime";

export interface DisconnectedStateProps {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  onConnected?: () => void;
}

export function useIsServiceConnected() {
  const { isLocalTarget, status } = useLocalAPI();
  const { general, error: generalError } = useGeneral();
  const isLocal = isLocalTarget;
  // If local, it is ONLY connected when the engine is actively running.
  // If remote, it is connected when general config is reachable without error.
  const isConnected = isLocal
    ? Boolean(status?.engine.running)
    : Boolean(general.mode && !generalError);
  return {
    isLocal,
    isLoading: false,
    isConnected,
    status,
    hasSub: Boolean(status?.activeSub),
  };
}

export function DisconnectedState({
  title,
  description,
  icon,
  action,
  className,
  onConnected,
}: DisconnectedStateProps) {
  const { t: tc } = useTranslation("common");
  const { t: tconn } = useTranslation("connect");
  const navigate = useNavigate();
  const { isLocalTarget, hasDaemon, daemonState, reconnect, up } =
    useLocalAPI();
  const { isLoading, hasSub } = useIsServiceConnected();
  const target = useAPIInfo();
  const [connecting, setConnecting] = useState(false);
  const [retrying, setRetrying] = useState(false);

  async function handleConnect() {
    if (connecting) return;
    setConnecting(true);
    try {
      await up();
      toast.success(tconn("connected"));
      onConnected?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setConnecting(false);
    }
  }

  async function handleRetry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await reconnect();
    } finally {
      setRetrying(false);
    }
  }

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex min-h-[360px] flex-1 items-center justify-center p-6",
          className,
        )}
      >
        <Card className="flex max-w-[460px] w-full min-h-[220px] flex-col items-center justify-center rounded-card border border-border/80 bg-card p-8 text-center shadow-elevation-card">
          <Spinner className="size-6 text-brand" />
        </Card>
      </div>
    );
  }

  let defaultTitle: ReactNode;
  let defaultDescription: ReactNode;
  let defaultAction: ReactNode;

  if (isLocalTarget) {
    if (!hasDaemon) {
      // 本機 daemon 離線：身份保留為本機（control-targets 邊界#2），交代的
      // 是服務連通事實，不是「未導入配置」或遠端控制器。
      defaultTitle =
        daemonState === "connecting"
          ? tconn("daemonConnecting")
          : tconn("daemonOffline");
      defaultDescription =
        description ??
        (daemonState === "connecting"
          ? tconn("daemonConnectingDesc")
          : tconn("daemonOfflineDesc"));
      defaultAction = (
        <Button disabled={retrying} onClick={() => void handleRetry()}>
          {retrying ? <Spinner className="mr-1.5 size-4" /> : null}
          {tc("retry")}
        </Button>
      );
    } else if (!hasSub) {
      defaultTitle = tconn("noConfigTitle");
      defaultDescription = description ?? tconn("noConfigDescription");
      defaultAction = (
        <Button onClick={() => navigate("/config")}>
          <Plus className="mr-1.5 size-4" />
          {tconn("importConfig")}
        </Button>
      );
    } else {
      defaultTitle = tconn("stopped");
      defaultDescription = description ?? tconn("readyToConnect");
      defaultAction = (
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <Button disabled={connecting} onClick={() => void handleConnect()}>
            {connecting ? (
              <Spinner className="mr-1.5 size-4" />
            ) : (
              <Power className="mr-1.5 size-4" />
            )}
            {connecting ? tc("loading") : tconn("connect")}
          </Button>
          <Button variant="outline" onClick={() => navigate("/")}>
            {tconn("goToConsole")}
            <ArrowRight className="ml-1.5 size-4" />
          </Button>
        </div>
      );
    }
  } else {
    defaultTitle = tconn("remoteNote");
    defaultDescription = description ?? tconn("remoteDisconnectedDesc");
    defaultAction = (
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <Button onClick={() => navigate("/")}>
          {tconn("goToConsole")}
          <ArrowRight className="ml-1.5 size-4" />
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            navigate(
              target.targetKind === "controller"
                ? `/config?item=controller:${target.controller.id}`
                : "/config?item=add-controller",
            )
          }
        >
          <Settings2 className="mr-1.5 size-4" />
          {tconn("manageController")}
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-[360px] flex-1 items-center justify-center p-6",
        className,
      )}
    >
      <Card className="flex w-full max-w-[460px] flex-col items-center justify-center rounded-card border border-border bg-card p-8 text-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-control bg-brand-soft text-brand-text">
          {icon ?? <Power className="size-7" />}
        </div>
        <h3 className="mb-2 text-[18px] font-semibold tracking-tight text-foreground">
          {title ?? defaultTitle}
        </h3>
        <p className="mb-6 max-w-sm text-sm text-muted-foreground leading-relaxed">
          {description ?? defaultDescription}
        </p>
        <div>{action ?? defaultAction}</div>
      </Card>
    </div>
  );
}
