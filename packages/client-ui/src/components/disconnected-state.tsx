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
  const { isLocalTarget, status, error } = useLocalAPI();
  const isLocal = isLocalTarget;
  // If local, it is ONLY connected when the engine is actively running
  const isConnected = isLocal ? Boolean(status?.engine.running) : !error;
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
  const { isLocalTarget, up } = useLocalAPI();
  const { isLoading, hasSub } = useIsServiceConnected();
  const target = useAPIInfo();
  const [connecting, setConnecting] = useState(false);

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
    if (!hasSub) {
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
          <Button variant="outline" onClick={() => navigate("/connect")}>
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
      <Button
        variant="outline"
        onClick={() =>
          navigate(
            target.id
              ? `/config?item=controller:${target.id}`
              : "/config?item=add-controller",
          )
        }
      >
        <Settings2 className="mr-1.5 size-4" />
        {tconn("manageController")}
      </Button>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-[360px] flex-1 items-center justify-center p-6",
        className,
      )}
    >
      <Card className="flex max-w-[460px] w-full flex-col items-center justify-center rounded-card border border-border/80 bg-card p-8 text-center shadow-elevation-card">
        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand-text shadow-sm">
          {icon ?? <Power className="size-7" />}
        </div>
        <h3 className="mb-2 text-lg font-semibold tracking-tight text-foreground">
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
