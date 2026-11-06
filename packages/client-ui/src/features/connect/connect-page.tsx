import { formatUptimeClock } from "@xbond/client/helper";
import { subscriptionQuota } from "@xbond/client/localapi";
import type { Snapshot } from "@xbond/client/request";
import { focusedGroup, strategyPath } from "@xbond/client/workspace";
import { useAtom, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Layers,
  Monitor,
  Network,
  Power,
  Route,
  Shield,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { CountryFlag } from "@/components/country-flag";
import { nodeFlagCode, stripFlagEmoji } from "@/components/country-flag";
import { DisconnectedState } from "@/components/disconnected-state";
import { SegmentedControl } from "@/components/segmented-control";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { useProxy, useProxyMapping } from "@/features/proxies/proxy-data";
import { useNodeSelection } from "@/features/proxies/use-node-selection";
import { errorKind, useAction } from "@/hooks/use-action";
import { useStreamReader, useStreamState } from "@/hooks/use-core-stream";
import { cn } from "@/lib/utils";
import { hasDaemonConfig } from "@/platform/local-api-bootstrap";
import { useAPIInfo, useClient, identityAtom } from "@/state/controller-target";
import { useGeneral } from "@/state/core-settings";
import { useLocalAPI } from "@/state/local-runtime";

import { ExternalControllerOnboarding } from "./external-controller-onboarding";
import { NodePicker, latencyClass } from "./node-picker";
import { OnboardingGuide } from "./onboarding-guide";
import { TrafficChart, type TrafficSample } from "./traffic-chart";

const focusAtom = atomWithStorage<Record<string, string>>(
  "xbond_focus_groups.v3",
  {},
);

/** 格式化流量速率，如 12.5 MB/s, 3.2 MB/s */
function formatDisplayRate(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];
  const exp = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytesPerSec || 1) / Math.log(1024)),
  );
  const val = bytesPerSec / Math.pow(1024, exp);
  const formatted = val >= 100 ? val.toFixed(0) : val.toFixed(1);
  return `${formatted} ${units[exp]}`;
}

/** 格式化累计/总量流量，如 1.8 GB, 392 GB, 500 GB */
function formatDisplayTraffic(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes || 1) / Math.log(1024)),
  );
  const val = bytes / Math.pow(1024, exp);
  const formatted = val >= 100 ? val.toFixed(0) : val.toFixed(1);
  return `${formatted} ${units[exp]}`;
}

function FactIcon({ kind }: { kind: "core" | "takeover" | "egress" }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 16,
    height: 16,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "opacity-[0.85]",
    "aria-hidden": true,
  };
  if (kind === "core") {
    return (
      <svg {...common}>
        <rect x="5" y="5" width="14" height="14" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
      </svg>
    );
  }
  if (kind === "takeover") {
    return (
      <svg {...common}>
        <circle cx="6" cy="6" r="2.6" />
        <circle cx="18" cy="6" r="2.6" />
        <circle cx="12" cy="18" r="2.6" />
        <path d="M7.8 7.6 10.4 16M16.2 7.6 13.6 16M8.6 6h6.8" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export default function Connect() {
  const { t } = useTranslation("connect");
  const { t: r } = useTranslation("runtime");
  const { t: tc } = useTranslation("common");
  const { t: px } = useTranslation("proxies");
  const { t: st } = useTranslation("settings");
  const controller = useAPIInfo();
  const client = useClient();
  const { general, update } = useGeneral();
  const nodeSelection = useNodeSelection();
  const { groups, global, isLoading: proxiesLoading } = useProxy();
  const mapping = useProxyMapping();
  const {
    hasLocalAPI,
    isLocalTarget,
    status,
    up,
    down,
    setMode,
    refresh,
    changeService,
    config: localConfig,
    error: localError,
  } = useLocalAPI();
  const { run, pending } = useAction();
  const setIdentity = useSetAtom(identityAtom);
  const [focus, setFocus] = useAtom(focusAtom);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [changingService, setChangingService] = useState(false);
  const [privilegeDialogOpen, setPrivilegeDialogOpen] = useState(false);
  const connectButtonRef = useRef<HTMLButtonElement>(null);
  const [connectError, setConnectError] = useState<{
    kind: "port_conflict" | "tun_denied" | "generic";
    message: string;
  } | null>(null);

  // Sleep/wake recovery: re-synchronize when device wakes or network reconnects
  useEffect(() => {
    const handleWakeSync = () => {
      void refresh();
    };
    window.addEventListener("online", handleWakeSync);
    window.addEventListener("focus", handleWakeSync);
    return () => {
      window.removeEventListener("online", handleWakeSync);
      window.removeEventListener("focus", handleWakeSync);
    };
  }, [refresh]);

  const handleToggleConnection = async () => {
    setConnectError(null);
    if (running) {
      await run(() => down(), false);
    } else {
      let caught: unknown = null;
      const ok = await run(async () => {
        try {
          await up();
        } catch (err) {
          caught = err;
          throw err;
        }
      }, false);
      if (!ok && caught) {
        const resMsg =
          (caught as { response?: { data?: { error?: string } } })?.response
            ?.data?.error ||
          (caught as Error)?.message ||
          String(caught);
        if (/already in use|bind|port/i.test(resMsg)) {
          setConnectError({ kind: "port_conflict", message: resMsg });
        } else if (/tun|privilege|admin|permission/i.test(resMsg)) {
          setConnectError({ kind: "tun_denied", message: resMsg });
        } else {
          setConnectError({ kind: "generic", message: resMsg });
        }
      }
    }
  };

  const available = general.mode.toLowerCase() === "global" ? [global] : groups;
  const focusKey = controller.focusKey;
  const group =
    (focus[focusKey]
      ? available.find((g) => g.name === focus[focusKey])
      : null) ??
    focusedGroup(available, focus[focusKey]) ??
    available[0] ??
    null;
  const chain = strategyPath(group, mapping);

  const traffic = useStreamReader<{ up: number; down: number }>("traffic");
  const trafficState = useStreamState(traffic);
  const connections = useStreamReader<Snapshot>("connections");
  const connectionState = useStreamState(connections);
  const [speed, setSpeed] = useState<{ up: number; down: number } | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<TrafficSample[]>([]);

  useEffect(() => {
    const onData = (items: { up: number; down: number }[]) => {
      setSpeed(items.at(-1) ?? null);
      const latest = items.at(-1);
      if (latest) {
        const at = Date.now();
        setHistory((previous) => [...previous, { ...latest, at }].slice(-60));
      }
    };
    traffic.subscribe("data", onData);
    return () => traffic.unsubscribe("data", onData);
  }, [traffic]);

  useEffect(() => {
    const onData = (items: Snapshot[]) => setSnapshot(items.at(-1) ?? null);
    connections.subscribe("data", onData);
    return () => connections.unsubscribe("data", onData);
  }, [connections]);

  // 重新連上串流時清空樣本：跨越失聯時段的線段不是真實走勢。
  const previousTrafficState = useRef(trafficState);
  useEffect(() => {
    if (trafficState === "open" && previousTrafficState.current !== "open") {
      setHistory([]);
      setSpeed(null);
    }
    previousTrafficState.current = trafficState;
  }, [trafficState]);

  const running = hasLocalAPI && (status?.engine.running ?? false);
  const sub = hasLocalAPI ? (status?.activeSub ?? null) : null;
  const quota = subscriptionQuota(sub);
  const coreOpen = trafficState === "open" || Boolean(general.mode);
  const active = hasLocalAPI ? running : !isLocalTarget && coreOpen;
  const remote =
    controller.targetKind === "controller" ? controller.controller : null;
  const remoteName =
    remote &&
    remote.name !== remote.url &&
    remote.name !== new URL(remote.url).host
      ? remote.name
      : "";
  const isSysproxy = hasLocalAPI
    ? (status?.preferences.systemProxy ??
      status?.preferences.takeoverMode === "sysproxy")
    : false;
  const isTun = hasLocalAPI
    ? (status?.preferences.tun ?? status?.preferences.takeoverMode === "tun")
    : false;
  const isServiceInstalled = hasLocalAPI
    ? Boolean(status?.capabilities?.serviceInstalled)
    : false;
  const isTunCapable = hasLocalAPI
    ? Boolean(
        status?.capabilities?.serviceInstalled || status?.capabilities?.tun,
      )
    : false;
  const [optimisticRouting, setOptimisticRouting] = useState<
    "rule" | "global" | "direct" | null
  >(null);
  const currentMode = (
    optimisticRouting ??
    (hasLocalAPI ? status?.preferences.routingMode : general.mode)
  )?.toLowerCase();
  const mixedPort = hasLocalAPI
    ? status?.engine.mixedPort || 7890
    : general.mixedPort || 7890;
  const egress = hasLocalAPI ? status?.threeTier : undefined;

  const handleChangeService = useCallback(
    async (install: boolean) => {
      const key = install ? "install" : "uninstall";
      setChangingService(true);
      try {
        toast.info(st(`takeover.${key}ServicePrompt`));
        const done = await changeService(install);
        if (!done) {
          toast.error(
            st(`takeover.${key}ServiceFailed`, {
              error: st("takeover.serviceChangeTimeout"),
            }),
          );
          return;
        }
        toast.success(st(`takeover.${key}ServiceSuccess`));
        if (install) {
          void run(() => setMode({ tun: true }), false);
        } else if (isTun) {
          void run(() => setMode({ tun: false }), false);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(st(`takeover.${key}ServiceFailed`, { error: msg }));
      } finally {
        setChangingService(false);
      }
    },
    [changeService, isTun, run, setMode, st],
  );

  // Latest known delay for a node, from the same history the proxies page reads.
  const nodeDelay = (name: string) => {
    const item = mapping.get(name);
    if (!item || !("history" in item)) return null;
    const last = item.history[item.history.length - 1];
    return last && last.delay > 0 ? last.delay : null;
  };

  const leafNodeName =
    chain.length > 0 ? chain[chain.length - 1] : (group?.now ?? "");
  const leafFlag = leafNodeName ? nodeFlagCode(leafNodeName) : null;
  const leafDelay = leafNodeName ? nodeDelay(leafNodeName) : null;
  const isDirect = leafNodeName.toLowerCase() === "direct";
  const isReject = leafNodeName.toLowerCase() === "reject";

  const uptimeClock = running ? formatUptimeClock(status?.engine.uptime) : null;
  const sessionTotal =
    connectionState === "open" && snapshot
      ? snapshot.downloadTotal + snapshot.uploadTotal
      : null;
  const quotaPercent =
    sub && quota ? Math.max(0, Math.min(100, quota.remainingPercent)) : null;

  const stateWord = hasLocalAPI
    ? running
      ? t("connected")
      : t("stopped")
    : trafficState === "open"
      ? t("coreReachable")
      : r(trafficState);
  const connectionAction = running ? t("disconnect") : t("connect");
  // 運行時的副行交代接管方式；未運行交代下一步，遠端交代管理歸屬。
  const stateNote = hasLocalAPI
    ? running
      ? isSysproxy && isTun
        ? t("runningDual")
        : isSysproxy
          ? t("runningSysproxy")
          : isTun
            ? t("runningTun")
            : t("runningPort", { port: mixedPort })
      : sub
        ? t("readyToConnect")
        : t("noConfig")
    : t("remoteNote");

  const facts = [
    {
      kind: "core" as const,
      tone: active ? "brand" : "muted",
      label: t("tiers.core"),
      value: hasLocalAPI
        ? status?.engine.running
          ? t("coreRunning")
          : t("stopped")
        : r(trafficState),
    },
    {
      kind: "takeover" as const,
      tone: hasLocalAPI ? (isSysproxy || isTun ? "ok" : "muted") : "muted",
      label: t("takeoverMode"),
      value: hasLocalAPI
        ? isSysproxy && isTun
          ? `${t("sysproxy")} + TUN`
          : isSysproxy
            ? t("sysproxy")
            : isTun
              ? t("tun")
              : t("portOnly")
        : tc("unknown"),
    },
    {
      kind: "egress" as const,
      tone: egress?.egressVerified ? "ok" : "muted",
      label: t("tiers.egress"),
      value: egress?.egressVerified
        ? egress.egressLatencyMs > 0
          ? `${egress.egressLatencyMs}ms`
          : t("egressVerified")
        : tc("unknown"),
    },
  ];

  function setFocusGroup(name: string) {
    setFocus((previous) => ({ ...previous, [focusKey]: name }));
  }

  const routingOptions = (["rule", "global", "direct"] as const).map(
    (mode) => ({
      value: mode,
      label: tc(`routingMode.${mode}`),
    }),
  );
  const routingValue = routingOptions.find(
    (option) => option.value === currentMode,
  )?.value;

  async function switchRouting(mode: "rule" | "global" | "direct") {
    setOptimisticRouting(mode);
    try {
      if (hasLocalAPI) {
        await setMode({ routing: mode });
      } else {
        if (!client) throw new Error("LocalAPI not available");
        await client.updateConfig({ mode });
        await update();
      }
    } catch (err) {
      toast.error(r(errorKind(err)), { duration: 6000 });
    } finally {
      setOptimisticRouting(null);
    }
  }

  return (
    <div className="page w-full lg:py-2">
      {localConfig && !status && (
        <div
          className="bento flex items-center justify-between gap-3 p-4 text-[13px]"
          role={localError ? "alert" : "status"}
        >
          <span className="text-muted-foreground">
            {localError ? t("statusReadFailed") : tc("loading")}
          </span>
          {localError && (
            <Button
              disabled={pending}
              onClick={() => void run(() => refresh(), false)}
            >
              {tc("retry")}
            </Button>
          )}
        </div>
      )}

      {hasLocalAPI && !sub && !running ? (
        <OnboardingGuide className="my-auto py-6" />
      ) : isLocalTarget && !hasLocalAPI ? (
        // 本機 daemon 離線：保留本機身份與重試入口，不顯示遠端控制器視圖。
        <DisconnectedState className="my-auto py-6" />
      ) : !hasDaemonConfig() && !active ? (
        <ExternalControllerOnboarding className="my-auto py-6" />
      ) : (
        <div className="mx-auto grid w-full min-w-0 flex-1 grid-cols-1 gap-4 [grid-template-areas:'control'_'strategy'_'live'_'prefs'] lg:max-h-[44rem] lg:max-w-6xl lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-3 lg:[grid-template-areas:'control_strategy'_'live_prefs'] xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <section
            className="bento bento-hero [grid-area:control] flex min-w-0 flex-col gap-3 p-4 lg:gap-2"
            aria-label={t("connect")}
          >
            <div
              className={cn(
                "grid min-w-0 flex-1 items-center gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-4",
                remote && "grid-cols-[minmax(0,1fr)_auto]",
              )}
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <h2
                  className="flex items-center gap-2.5 text-headline leading-tight font-semibold tracking-tight text-foreground xl:text-display"
                  aria-live="polite"
                >
                  {remote && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        trafficState === "open"
                          ? "bg-success"
                          : "bg-muted-foreground/55",
                      )}
                    />
                  )}
                  {stateWord}
                </h2>
                {remote && (
                  <div className="flex w-full min-w-0 flex-wrap gap-x-2 text-label">
                    {remoteName && (
                      <span
                        className="max-w-full truncate font-medium text-foreground"
                        title={remoteName}
                      >
                        {remoteName}
                      </span>
                    )}
                    <span
                      className="max-w-full truncate font-mono text-muted-foreground"
                      title={remote.url}
                    >
                      {remote.url}
                    </span>
                  </div>
                )}
                <p className="max-w-[40ch] text-body text-muted-foreground">
                  {stateNote}
                </p>
                {uptimeClock && (
                  <p
                    className="font-mono text-label font-medium tabular-nums text-muted-foreground max-md:hidden"
                    aria-label={t("uptime", { duration: uptimeClock })}
                  >
                    {uptimeClock}
                  </p>
                )}
              </div>
              {hasLocalAPI ? (
                <Button
                  type="button"
                  ref={connectButtonRef}
                  variant={running ? "outline" : "brand"}
                  className={cn(
                    "h-auto min-h-12 w-full gap-2 rounded-control px-4 py-2.5 text-body leading-tight whitespace-normal max-md:min-h-12 lg:min-h-11 lg:w-auto",
                    running && "border-brand/35 bg-brand-soft text-brand-text",
                  )}
                  disabled={pending || (!running && !sub)}
                  aria-busy={pending}
                  onClick={() => void handleToggleConnection()}
                >
                  {pending ? (
                    <span
                      aria-hidden="true"
                      className="size-5 shrink-0 animate-[native-spin_0.8s_linear_infinite] rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
                    />
                  ) : (
                    <Power aria-hidden="true" className="size-5" />
                  )}
                  {connectionAction}
                </Button>
              ) : (
                remote && (
                  <span
                    aria-hidden="true"
                    className="grid size-12 place-items-center rounded-card border border-brand/20 bg-brand-soft/55 text-brand-text lg:size-14"
                  >
                    <Monitor className="size-6 lg:size-7" strokeWidth={1.65} />
                  </span>
                )
              )}
            </div>

            <ul
              className={cn(
                "bento-inset grid list-none gap-2 p-2.5",
                remote ? "grid-cols-2" : "grid-cols-3",
              )}
            >
              {facts
                .filter((fact) => !remote || fact.kind !== "core")
                .map((fact) => (
                  <li
                    key={fact.kind}
                    className="flex min-w-0 flex-col gap-1 text-label"
                  >
                    <span className="flex items-center gap-1 text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0">
                      <FactIcon kind={fact.kind} />
                      {fact.label}
                    </span>
                    <b
                      className={cn(
                        "font-semibold tabular-nums [overflow-wrap:anywhere]",
                        fact.tone === "brand"
                          ? "text-brand-text"
                          : fact.tone === "ok"
                            ? "text-success-text"
                            : "text-foreground",
                      )}
                    >
                      {fact.value}
                    </b>
                  </li>
                ))}
            </ul>

            {remote ? (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 flex-1 basis-36 text-label text-muted-foreground">
                  {t("noConfigRemote")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIdentity(false)}
                >
                  {t("manageController")}
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 rtl:rotate-180"
                  />
                </Button>
              </div>
            ) : (
              hasLocalAPI && (
                <div className="flex min-w-0 items-center gap-2 text-label text-muted-foreground">
                  <Layers aria-hidden="true" className="size-4 shrink-0" />
                  <span
                    className="min-w-0 flex-1 truncate font-medium text-foreground"
                    title={sub?.name}
                  >
                    {sub ? (
                      <>
                        <span className="sr-only">{t("currentConfig")} </span>
                        {sub.name}
                      </>
                    ) : (
                      t("noConfig")
                    )}
                  </span>
                  <Link
                    to="/config"
                    className="inline-flex min-h-8 shrink-0 items-center gap-1 font-medium text-brand-text hover:underline hover:underline-offset-4 max-md:min-h-11"
                  >
                    {t("manage")}
                    <ChevronRight
                      aria-hidden="true"
                      className="size-3.5 rtl:rotate-180"
                    />
                  </Link>
                </div>
              )
            )}
          </section>

          <section
            className="bento [grid-area:strategy] flex min-w-0 flex-col gap-3 p-4 lg:gap-2"
            aria-label={t("strategyGroups")}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h2 className="text-subtitle font-semibold text-foreground">
                {t("strategyGroups")}
              </h2>
              <Link
                to="/proxies"
                className="inline-flex min-h-8 items-center gap-1 text-label font-medium text-muted-foreground hover:text-brand-text hover:underline hover:underline-offset-4 max-md:min-h-11"
              >
                {t("allStrategies")}
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 rtl:rotate-180"
                />
              </Link>
            </div>

            {group && (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-0.5 text-label text-muted-foreground">
                  {available.length > 1 ? (
                    <label htmlFor="home-policy-group" className="sr-only">
                      {t("chooseGroup")}
                    </label>
                  ) : (
                    <span className="sr-only">{t("chooseGroup")}</span>
                  )}
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="font-mono [overflow-wrap:anywhere]">
                      {group.type}
                    </span>
                    {group.all && (
                      <span className="tabular-nums">
                        {group.all.length} {t("strategyMembers")}
                      </span>
                    )}
                  </span>
                </div>
                {available.length > 1 ? (
                  <NativeSelect
                    id="home-policy-group"
                    size="sm"
                    wrapperClassName="w-full"
                    className="truncate border-border bg-inset/70 max-md:min-h-11"
                    value={group.name}
                    title={group.name}
                    onChange={(event) => setFocusGroup(event.target.value)}
                  >
                    {available.map((item) => (
                      <NativeSelectOption key={item.name} value={item.name}>
                        {item.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : (
                  <p
                    className="truncate text-body font-medium text-foreground"
                    title={group.name}
                  >
                    {group.name}
                  </p>
                )}
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
              <button
                type="button"
                className="bento-inset group flex w-full cursor-pointer items-center gap-3 rounded-control px-3 py-2 text-start text-foreground transition-colors hover:border-brand/35 hover:bg-brand-soft/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
                onClick={() => setPickerOpen(true)}
                aria-haspopup="dialog"
              >
                {/* 节点图标头像 (40px 圆角国旗 / 直连 / 拦截 / 服务器图标) */}
                <span
                  className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-control bg-card"
                  aria-hidden="true"
                >
                  {isDirect ? (
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  ) : isReject ? (
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                    </svg>
                  ) : leafFlag ? (
                    <CountryFlag code={leafFlag} avatar className="size-full" />
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="4" width="18" height="7" rx="2" />
                      <rect x="3" y="13" width="18" height="7" rx="2" />
                      <line x1="7" y1="7.5" x2="7.01" y2="7.5" />
                      <line x1="7" y1="16.5" x2="7.01" y2="16.5" />
                    </svg>
                  )}
                </span>

                {/* 节点名称、延迟与策略链路 */}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-label font-medium text-muted-foreground">
                    {t("currentNode")}
                  </span>
                  <span
                    className="truncate text-subtitle font-semibold"
                    title={
                      leafNodeName
                        ? leafFlag
                          ? stripFlagEmoji(leafNodeName)
                          : leafNodeName
                        : undefined
                    }
                  >
                    {leafNodeName
                      ? leafFlag
                        ? stripFlagEmoji(leafNodeName)
                        : leafNodeName
                      : t("strategy.noNodeSelected")}
                  </span>

                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-label tabular-nums text-muted-foreground">
                    {leafDelay ? (
                      <>
                        <b
                          className={cn(
                            "shrink-0 font-mono text-label font-semibold tabular-nums",
                            latencyClass(leafDelay),
                          )}
                        >
                          {leafDelay} ms
                        </b>
                        <span>{t("lastMeasured")}</span>
                      </>
                    ) : leafNodeName ? (
                      px("untested")
                    ) : null}
                  </span>
                </span>

                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-control bg-card group-hover:bg-brand-soft group-hover:text-brand-text"
                >
                  <ChevronRight className="size-4 rtl:rotate-180" />
                </span>
              </button>
              {chain.length > 2 && (
                <p className="flex min-w-0 items-center gap-1.5 px-1 text-label text-muted-foreground">
                  <Route
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-brand-text"
                  />
                  <span className="sr-only">{t("routingChain")}</span>
                  <span className="truncate" title={chain.join(" → ")}>
                    {chain.join(" → ")}
                  </span>
                </p>
              )}
            </div>
          </section>

          <section
            className="bento [grid-area:live] flex min-w-0 flex-col gap-3 p-4 lg:gap-2"
            aria-label={t("trafficStats")}
          >
            <h2 className="text-subtitle font-semibold text-foreground">
              {t("trafficStats")}
            </h2>
            <dl className="grid grid-cols-2 divide-x divide-border">
              {(
                [
                  { direction: "download", rate: speed?.down, Icon: ArrowDown },
                  { direction: "upload", rate: speed?.up, Icon: ArrowUp },
                ] as const
              ).map(({ direction, rate, Icon }) => (
                <div
                  key={direction}
                  className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 px-2 first:ps-0 last:pe-0"
                >
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "row-span-2 size-4",
                      direction === "download"
                        ? "text-brand-text"
                        : "text-muted-foreground",
                    )}
                  />
                  <dt className="col-start-2 text-label text-muted-foreground">
                    {t(direction)}
                  </dt>
                  <dd className="col-start-2 text-title leading-tight font-semibold tabular-nums text-foreground">
                    {trafficState === "open" && rate !== undefined
                      ? formatDisplayRate(rate)
                      : "—"}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="bento-inset flex min-h-28 min-w-0 flex-1 rounded-control px-2 py-2">
              <TrafficChart
                samples={history}
                title={t("trafficHistory")}
                empty={t("collectingSamples")}
                stale={trafficState !== "open"}
                staleLabel={t("streamStopped")}
                windowLabel={t("recentWindow")}
              />
            </div>

            <dl className="grid grid-cols-2 gap-3 border-t border-border pt-2">
              <div className="min-w-0">
                <dt className="text-label text-muted-foreground">
                  {t("sessionTotal")}
                </dt>
                <dd className="mt-0.5 text-subtitle font-semibold tabular-nums text-foreground">
                  {sessionTotal !== null
                    ? formatDisplayTraffic(sessionTotal)
                    : "—"}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-label text-muted-foreground">
                  {t("quota.remaining")}
                </dt>
                <dd className="mt-0.5">
                  {sub && quota ? (
                    <>
                      <b className="text-subtitle font-semibold tabular-nums text-foreground">
                        {formatDisplayTraffic(quota.remaining)}{" "}
                        <span className="text-label font-normal text-muted-foreground">
                          / {formatDisplayTraffic(sub.total)}
                        </span>
                      </b>
                      <span
                        className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-inset"
                        role="meter"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(quotaPercent ?? 0)}
                        aria-label={t("quota.remaining")}
                      >
                        <span
                          className="block h-full origin-left rounded-full bg-brand transition-[width] duration-300 motion-reduce:transition-none"
                          style={{ width: `${Math.round(quotaPercent ?? 0)}%` }}
                        />
                      </span>
                    </>
                  ) : (
                    <span className="text-label text-muted-foreground">
                      {sub
                        ? t("quota.unknown")
                        : hasLocalAPI
                          ? t("noConfig")
                          : t("quotaUnavailable")}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section
            className={cn(
              "bento [grid-area:prefs] flex min-w-0 flex-col gap-3 p-4 lg:gap-2",
              !hasLocalAPI && "lg:self-start",
            )}
            aria-label={t("prefs")}
          >
            <h2 className="text-subtitle font-semibold text-foreground">
              {t("prefs")}
            </h2>
            <div className="flex flex-col gap-1.5">
              <span className="text-label font-medium text-muted-foreground">
                {tc("routingMode.title")}
              </span>
              <SegmentedControl
                ariaLabel={tc("routingMode.title")}
                options={routingOptions}
                value={routingValue ?? null}
                disabled={pending}
                className="grid w-full grid-cols-3"
                itemClassName="px-2 whitespace-normal data-[state=on]:text-brand-text"
                onChange={(mode) => void switchRouting(mode)}
              />
              {currentMode === "rule" ||
              currentMode === "global" ||
              currentMode === "direct" ? (
                <p className="m-0 text-[11px] leading-4 text-muted-foreground">
                  {t(`routingHint.${currentMode}`)}
                </p>
              ) : null}
            </div>
            {hasLocalAPI && (
              <div className="flex flex-col divide-y divide-border border-t border-border pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                  <span className="text-label font-medium text-muted-foreground">
                    {t("takeoverMode")}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-control bg-inset px-2 py-0.5 text-label text-muted-foreground">
                    <span className="font-sans text-[11px] text-muted-foreground">
                      {t("port")}
                    </span>
                    <span className="font-semibold text-foreground">
                      {mixedPort}
                    </span>
                  </span>
                </div>

                {/* System Proxy */}
                <div className="flex items-center gap-2.5 py-2">
                  <Network
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <strong className="text-[13px] font-semibold text-foreground">
                      {t("sysproxy")}
                    </strong>
                    <span className="text-[11px] leading-4 text-muted-foreground">
                      {st("takeover.sysproxyDesc")}
                    </span>
                  </div>
                  <Switch
                    checked={isSysproxy}
                    disabled={pending}
                    onCheckedChange={(checked: boolean) =>
                      void run(() => setMode({ systemProxy: checked }), false)
                    }
                    aria-label={t("sysproxy")}
                  />
                </div>

                {/* Virtual NIC (TUN) */}
                <div className="flex items-center gap-2.5 py-2">
                  <Shield
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <strong className="text-[13px] font-semibold text-foreground">
                        {t("tun")}
                      </strong>
                      {hasLocalAPI && (
                        <HoverCard openDelay={150} closeDelay={200}>
                          <HoverCardTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "inline-flex size-4 cursor-pointer items-center justify-center rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                isServiceInstalled
                                  ? "text-muted-foreground/60 hover:text-foreground"
                                  : "text-warning-text hover:text-foreground",
                              )}
                              aria-label={
                                isServiceInstalled
                                  ? st("takeover.serviceInstalled")
                                  : st("takeover.tunPrivilegeHint")
                              }
                            >
                              <AlertCircle className="size-3.5" />
                            </button>
                          </HoverCardTrigger>
                          <HoverCardContent
                            align="start"
                            side="top"
                            className="flex flex-col gap-2.5 w-68 p-3 text-xs"
                          >
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5 font-medium text-foreground">
                                <AlertCircle
                                  className={cn(
                                    "size-3.5 shrink-0",
                                    isServiceInstalled
                                      ? "text-success-text"
                                      : "text-warning-text",
                                  )}
                                />
                                <span>
                                  {isServiceInstalled
                                    ? st("takeover.serviceInstalled")
                                    : st("takeover.tunPrivilegeRequired")}
                                </span>
                              </div>
                              <p className="text-muted-foreground leading-relaxed text-[11px]">
                                {isServiceInstalled
                                  ? st("takeover.serviceInstalledDesc")
                                  : status?.capabilities?.tunReasonCode
                                    ? st(
                                        `takeover.tunUnavailable.${status.capabilities.tunReasonCode}` as const,
                                      )
                                    : st("takeover.tunPrivilegeHint")}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant={
                                isServiceInstalled ? "outline" : "default"
                              }
                              disabled={changingService}
                              className={cn(
                                "h-7 w-full text-xs font-medium cursor-pointer",
                                !isServiceInstalled &&
                                  "bg-brand-action text-brand-action-foreground hover:bg-brand-action-hover",
                              )}
                              onClick={() =>
                                isServiceInstalled
                                  ? void handleChangeService(false)
                                  : setPrivilegeDialogOpen(true)
                              }
                            >
                              {changingService
                                ? st("takeover.installingService")
                                : isServiceInstalled
                                  ? st("takeover.uninstallService")
                                  : st("takeover.installService")}
                            </Button>
                          </HoverCardContent>
                        </HoverCard>
                      )}
                    </div>
                    <span className="text-[11px] leading-4 text-muted-foreground">
                      {st("takeover.tunDesc")}
                    </span>
                  </div>
                  <Switch
                    checked={isTun}
                    disabled={pending || changingService}
                    onCheckedChange={(checked: boolean) => {
                      if (checked && !isTunCapable) {
                        setPrivilegeDialogOpen(true);
                        return;
                      }
                      void run(() => setMode({ tun: checked }), false);
                    }}
                    aria-label={t("tun")}
                  />
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* 首次打開才掛載，避免常駐離屏層（Sheet 常駐會殘留 aria 節點）。 */}
      {pickerOpen && (
        <NodePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          groups={available}
          loading={proxiesLoading}
          focusGroupName={group?.name ?? null}
          onFocusGroup={setFocusGroup}
          chain={chain}
          nodeDelay={nodeDelay}
          mapping={mapping}
          selection={nodeSelection}
          onSelect={async (groupName, nodeName) => {
            setFocusGroup(groupName);
            await nodeSelection.select(groupName, nodeName);
          }}
        />
      )}

      <AlertDialog
        open={connectError !== null}
        onOpenChange={(open) => {
          if (!open) setConnectError(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!privilegeDialogOpen) connectButtonRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {connectError?.kind === "port_conflict"
                ? t("portConflictTitle")
                : connectError?.kind === "tun_denied"
                  ? t("tunDeniedTitle")
                  : t("connectFailed")}
            </AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              {connectError?.kind === "port_conflict"
                ? t("portConflictDesc")
                : connectError?.kind === "tun_denied"
                  ? t("tunDeniedDesc")
                  : connectError?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-wrap">
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            {connectError?.kind === "port_conflict" && (
              <AlertDialogAction
                onClick={() => void run(() => up({ port: 7891 }), false)}
              >
                {t("switchPortAndRetry")}
              </AlertDialogAction>
            )}
            {connectError?.kind === "tun_denied" && (
              <>
                <AlertDialogAction
                  variant="outline"
                  onClick={() => setPrivilegeDialogOpen(true)}
                >
                  {st("takeover.installService")}
                </AlertDialogAction>
                <AlertDialogAction
                  onClick={async () => {
                    await setMode({ systemProxy: true, tun: false });
                    await run(() => up(), false);
                  }}
                >
                  {t("fallbackSysproxy")}
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={privilegeDialogOpen}
        onOpenChange={setPrivilegeDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {st("takeover.privilegeDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {st("takeover.privilegeDialogDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPrivilegeDialogOpen(false);
                void handleChangeService(true);
              }}
            >
              {st("takeover.installService")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
