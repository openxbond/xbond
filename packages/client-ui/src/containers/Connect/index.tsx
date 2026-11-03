import { Button, CountryFlag, Segmented } from "@components";
import { nodeFlagCode, stripFlagEmoji } from "@components/CountryFlag";
import { Sheet, SheetContent, SheetTitle } from "@components/ui/sheet";
import { useAction } from "@lib/actions";
import { useNodeSelection } from "@lib/node-selection";
import {
  useAPIInfo,
  useClient,
  useGeneral,
  useLocalAPI,
  useProxy,
  useProxyMapping,
  useStreamReader,
  useStreamState,
  identityAtom,
} from "@stores";
import { formatRate } from "@xbond/client/activity";
import { formatTraffic, formatUptimeClock } from "@xbond/client/helper";
import { subscriptionQuota } from "@xbond/client/localapi";
import type { Snapshot } from "@xbond/client/request";
import {
  focusedGroup,
  strategyPath,
  controllerIdentity,
} from "@xbond/client/workspace";
import { cn } from "cn";
import { useAtom, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { TrafficChart, type TrafficSample } from "./chart";
import { NodePicker, latencyClass } from "./NodePicker";

const focusAtom = atomWithStorage<Record<string, string>>(
  "xbond_focus_groups.v3",
  {},
);

/* 任務卡（乳白實面、髮邊、卡片陰影），四張卡共用。 */
const cardSurface =
  "rounded-card border border-[color:color-mix(in_srgb,var(--border)_65%,transparent)] bg-[color:color-mix(in_srgb,var(--card)_96%,transparent)] shadow-elevation-card";

/* 連線主操作：品牌橙圓形電源鍵，深色電源符號，克制光環。 */
const orbBase =
  "relative grid size-[124px] max-md:size-24 shrink-0 cursor-pointer place-items-center mt-2.5 mb-1.5 rounded-full focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-8 [transition:transform_var(--duration-fast)_var(--ease-out-expo),box-shadow_var(--duration-base)_var(--ease-out-expo)] motion-reduce:[transition:none] enabled:hover:shadow-[inset_0_0_0_1px_var(--brand),0_10px_28px_-12px_var(--brand-text)] enabled:active:[transform:scale(0.97)]";
const orbOn =
  "bg-[image:var(--orb-gradient)] text-brand-foreground shadow-[inset_0_2px_3px_rgba(255,255,255,0.65),inset_0_-4px_8px_rgba(0,0,0,0.22),var(--orb-glow)]";
const orbOff =
  "border border-border bg-[image:linear-gradient(145deg,#ffffff_0%,var(--surface-inset)_100%)] text-muted-foreground shadow-[inset_0_2px_2px_rgba(255,255,255,0.9),inset_0_-2px_4px_rgba(0,0,0,0.04),0_4px_14px_rgba(0,0,0,0.05)]";

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
  const { groups, global } = useProxy();
  const mapping = useProxyMapping();
  const {
    hasLocalAPI,
    isLocalTarget,
    status,
    up,
    down,
    setMode,
    refresh,
    config: localConfig,
    error: localError,
  } = useLocalAPI();
  const { run, pending } = useAction();
  const setIdentity = useSetAtom(identityAtom);
  const [focus, setFocus] = useAtom(focusAtom);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [takeoverSheetOpen, setTakeoverSheetOpen] = useState(false);

  const available = general.mode.toLowerCase() === "global" ? [global] : groups;
  const focusKey = controllerIdentity(controller.id, controller.url);
  const group = focusedGroup(available, focus[focusKey]);
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

  const running = hasLocalAPI && (status?.engine.running ?? false);
  const sub = hasLocalAPI ? (status?.activeSub ?? null) : null;
  const quota = subscriptionQuota(sub);
  const coreOpen = trafficState === "open";
  const active = hasLocalAPI ? running : !isLocalTarget && coreOpen;
  const takeover = hasLocalAPI ? status?.preferences.takeoverMode : undefined;
  const currentMode = (
    hasLocalAPI ? status?.preferences.routingMode : general.mode
  )?.toLowerCase();
  const mixedPort = hasLocalAPI
    ? status?.engine.mixedPort || 7890
    : general.mixedPort || 7890;

  // Latest known delay for a node, from the same history the proxies page reads.
  const nodeDelay = (name: string) => {
    const item = mapping.get(name);
    if (!item || !("history" in item)) return null;
    const last = item.history[item.history.length - 1];
    return last && last.delay > 0 ? last.delay : null;
  };

  const uptimeClock = running ? formatUptimeClock(status?.engine.uptime) : null;
  const sessionTotal =
    connectionState === "open" && snapshot
      ? snapshot.downloadTotal + snapshot.uploadTotal
      : null;
  const quotaPercent =
    sub && quota ? Math.max(0, Math.min(100, quota.remainingPercent)) : null;
  const currentDelay = group?.now ? nodeDelay(group.now) : null;
  const nodeFlag = group?.now ? nodeFlagCode(group.now) : null;

  const stateWord = hasLocalAPI
    ? running
      ? t("connected")
      : t("stopped")
    : trafficState === "open"
      ? t("coreReachable")
      : r(trafficState);
  // 運行時的副行交代接管方式；未運行交代下一步，遠端交代管理歸屬。
  const stateNote = hasLocalAPI
    ? running
      ? takeover === "sysproxy"
        ? t("runningSysproxy")
        : takeover === "tun"
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
      tone: hasLocalAPI
        ? takeover === "port"
          ? "muted"
          : status?.threeTier.trafficIntercepted
            ? "ok"
            : "muted"
        : "muted",
      label: t("takeoverMode"),
      value: takeover ? t(takeover) : tc("unknown"),
    },
    {
      kind: "egress" as const,
      tone: status?.threeTier.egressVerified ? "ok" : "muted",
      label: t("tiers.egress"),
      value: status?.threeTier.egressVerified
        ? status.threeTier.egressLatencyMs > 0
          ? `${status.threeTier.egressLatencyMs}ms`
          : t("egressVerified")
        : tc("unknown"),
    },
  ];

  function setFocusGroup(name: string) {
    setFocus((previous) => ({ ...previous, [focusKey]: name }));
  }

  const takeoverOptions = (["sysproxy", "tun", "port"] as const).map(
    (mode) => ({
      value: mode,
      label: t(mode),
      disabledReason:
        mode === "tun" && status?.capabilities?.tun === false
          ? (status.capabilities.tunReason ?? undefined)
          : undefined,
    }),
  );

  const routingOptions = (["rule", "global", "direct"] as const).map(
    (mode) => ({
      value: mode,
      label: tc(`routingMode.${mode}`),
    }),
  );
  // Segmented 的泛型由 options 收窄；value 只在當前模式確實是三擋之一時傳入。
  const routingValue = routingOptions.find(
    (option) => option.value === currentMode,
  )?.value;

  async function switchRouting(mode: "rule" | "global" | "direct") {
    await run(async () => {
      if (hasLocalAPI) {
        await setMode({ routing: mode });
      } else {
        await client.updateConfig({ mode });
        await update();
      }
    }, false);
  }

  return (
    <div className="page w-full">
      {localConfig && !status && (
        <div
          className="flex items-center justify-between gap-3 rounded-control border border-border bg-card px-4 py-3 text-sm"
          role={localError ? "alert" : "status"}
        >
          <span>{localError ? t("statusReadFailed") : tc("loading")}</span>
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

      <div className="grid w-full grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4 [grid-template-areas:'control_aside'_'live_live'] max-md:grid-cols-1 max-md:[grid-template-areas:'control'_'aside'_'live']">
        <section
          className={cn(
            cardSurface,
            "[grid-area:control] flex flex-col items-center justify-center gap-2.5 pt-8 px-7 pb-6 text-center max-md:pt-7 max-md:px-5 max-md:pb-5",
          )}
          aria-label={t("connect")}
        >
          {hasLocalAPI ? (
            <button
              type="button"
              className={cn(orbBase, active ? orbOn : orbOff)}
              disabled={pending || (!running && !sub)}
              aria-pressed={active}
              aria-label={`${stateWord} — ${running ? t("disconnect") : t("connect")}`}
              onClick={() => void run(() => (running ? down() : up()), false)}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute -inset-2 rounded-full border-[1.5px]",
                  active
                    ? "animate-[native-breathe_2.4s_ease-in-out_infinite] border-[color:color-mix(in_srgb,var(--brand)_45%,transparent)] motion-reduce:animate-none"
                    : "border-[color:color-mix(in_srgb,var(--border)_80%,transparent)]",
                )}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute -inset-[38px] rounded-full",
                  active
                    ? "bg-[image:radial-gradient(circle,rgba(255,107,0,0.22)_0%,rgba(255,107,0,0.08)_45%,transparent_72%)]"
                    : "hidden",
                )}
              />
              {pending ? (
                <span
                  aria-hidden="true"
                  className="size-[30px] animate-[native-spin_0.8s_linear_infinite] rounded-full border-[3px] border-current border-t-transparent"
                />
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="40"
                  height="40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden="true"
                  className={cn(
                    "size-10 max-md:size-8",
                    active && "drop-shadow-[0_1px_2px_rgba(0,0,0,0.22)]",
                  )}
                >
                  <path d="M12 2v10" />
                  <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
                </svg>
              )}
            </button>
          ) : (
            // A plain Clash-API remote has nothing this dashboard can start
            // or stop: the honest main action is managing the target itself.
            <button
              type="button"
              className={cn(orbBase, orbOff)}
              aria-label={t("manageController")}
              onClick={() => setIdentity(false)}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-2 rounded-full border-[1.5px] border-[color:color-mix(in_srgb,var(--border)_80%,transparent)]"
              />
              <svg
                viewBox="0 0 24 24"
                width="34"
                height="34"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="size-10 max-md:size-8"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </button>
          )}

          <h2 className="m-0 text-display font-bold leading-[1.25] tracking-[-0.02em] text-foreground max-md:text-headline">
            {stateWord}
          </h2>
          <p className="m-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {stateNote}
          </p>
          {uptimeClock && (
            <p
              className="m-0 mt-1 text-subtitle font-medium font-mono tracking-[0.05em] tabular-nums text-muted-foreground max-md:hidden"
              aria-label={t("uptime", { duration: uptimeClock })}
            >
              {uptimeClock}
            </p>
          )}
          {!hasLocalAPI && (
            <button
              type="button"
              className="cursor-pointer rounded-sm px-1.5 py-1 text-body font-semibold text-brand-text"
              onClick={() => setIdentity(false)}
            >
              {t("manageController")}
            </button>
          )}

          <ul className="mt-3.5 grid self-stretch list-none grid-cols-3 border-t border-[color:color-mix(in_srgb,var(--border)_70%,transparent)] pt-[18px]">
            {facts.map((fact) => (
              <li
                key={fact.kind}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-[7px] border-[color:color-mix(in_srgb,var(--border)_70%,transparent)] px-2 text-xs text-muted-foreground not-first:border-l",
                  fact.tone === "brand" && "text-brand-text",
                  fact.tone === "ok" && "text-success-text",
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  <FactIcon kind={fact.kind} />
                  {fact.label}
                </span>
                <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-[7px] shrink-0 rounded-full",
                      fact.tone === "brand"
                        ? "bg-brand"
                        : fact.tone === "ok"
                          ? "bg-success"
                          : "bg-muted-foreground opacity-55",
                    )}
                  />
                  <b
                    className={cn(
                      "text-sm font-semibold tabular-nums [overflow-wrap:anywhere]",
                      fact.tone === "brand"
                        ? "text-brand-text"
                        : fact.tone === "ok"
                          ? "text-success-text"
                          : "text-foreground",
                    )}
                  >
                    {fact.value}
                  </b>
                </span>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2.5 self-stretch mt-4 border-t border-[color:color-mix(in_srgb,var(--border)_70%,transparent)] px-1 pt-4 text-body text-muted-foreground max-md:hidden">
            <span
              className="grid size-8 shrink-0 place-items-center rounded-[11px] bg-inset text-muted-foreground shadow-[inset_0_1px_0_oklch(1_0_0/55%)]"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m12 2 9 5-9 5-9-5 9-5z" />
                <path d="m3 12 9 5 9-5" />
                <path d="m3 17 9 5 9-5" />
              </svg>
            </span>
            {sub ? (
              <span className="min-w-0 truncate">
                {t("currentConfig")}{" "}
                <b className="font-semibold text-foreground">{sub.name}</b>
              </span>
            ) : (
              <span className="min-w-0 truncate">
                {hasLocalAPI ? t("noConfig") : t("noConfigRemote")}
              </span>
            )}
            {hasLocalAPI && (
              <Link
                to="/subscriptions"
                className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-body font-semibold text-brand-text no-underline hover:underline hover:underline-offset-4"
              >
                {t("manage")}
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            )}
          </div>
        </section>

        <div className="[grid-area:aside] flex min-w-0 flex-col gap-4">
          <section
            className={cn(
              cardSurface,
              "flex flex-col gap-3.5 py-5 px-[22px] max-md:p-[18px]",
            )}
            aria-label={t("currentNode")}
          >
            <h2 className="text-subtitle font-semibold">{t("currentNode")}</h2>
            <button
              type="button"
              className="group flex w-full cursor-pointer items-center gap-3.5 rounded-[18px] border border-[color:color-mix(in_srgb,var(--border)_65%,transparent)] bg-card px-3.5 py-3 text-left text-foreground shadow-[0_1px_2px_oklch(0.55_0.08_60/0.04)] [transition:box-shadow_var(--duration-fast)_var(--ease-out-expo),border-color_var(--duration-fast)_var(--ease-out-expo)] motion-reduce:[transition:none] enabled:hover:border-[color:color-mix(in_srgb,var(--border-strong)_80%,transparent)] enabled:hover:shadow-[0_2px_8px_oklch(0.55_0.08_60/0.07)]"
              onClick={() => setPickerOpen(true)}
              aria-haspopup="dialog"
            >
              <span
                className="grid size-[46px] shrink-0 place-items-center overflow-hidden rounded-[13px] bg-inset text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border)_60%,transparent),0_1px_3px_oklch(0.55_0.08_60/0.06)]"
                aria-hidden="true"
              >
                {nodeFlag ? (
                  <CountryFlag
                    code={nodeFlag}
                    className="size-full bg-cover bg-center"
                  />
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
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
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-label text-muted-foreground">
                  {t("nodeSelection")}
                </span>
                <span className="truncate text-subtitle font-[650]">
                  {group?.now
                    ? nodeFlag
                      ? stripFlagEmoji(group.now)
                      : group.now
                    : t("strategy.noNodeSelected")}
                </span>
                <span className="truncate text-label tabular-nums text-muted-foreground">
                  {currentDelay ? (
                    <>
                      <b
                        className={cn(
                          "shrink-0 font-mono text-xs tabular-nums",
                          latencyClass(currentDelay),
                        )}
                      >
                        {currentDelay} ms
                      </b>
                      {` · ${t("lastMeasured")}`}
                    </>
                  ) : group?.now ? (
                    px("untested")
                  ) : (
                    t("strategy.title")
                  )}
                </span>
              </span>
              <span
                className="grid size-8 shrink-0 place-items-center rounded-full bg-inset text-muted-foreground shadow-[inset_0_1px_0_oklch(1_0_0/50%)] [transition:color_var(--duration-fast)_ease] group-hover:text-brand-text"
                aria-hidden="true"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </span>
            </button>
          </section>

          <section
            className={cn(
              cardSurface,
              "flex flex-1 flex-col gap-3.5 py-5 px-[22px] max-md:p-[18px]",
            )}
            aria-label={t("prefs")}
          >
            <h2 className="text-subtitle font-semibold">{t("prefs")}</h2>
            {hasLocalAPI && (
              <div className="flex flex-col gap-2.5 rounded-[18px] border border-[color:color-mix(in_srgb,var(--border)_65%,transparent)] bg-card px-4 py-3.5 shadow-[0_1px_2px_oklch(0.55_0.08_60/0.04)]">
                <div className="flex items-center gap-2">
                  <span className="text-label font-semibold text-muted-foreground">
                    {t("takeoverMode")}
                  </span>
                  <button
                    type="button"
                    className="ml-auto hidden max-md:inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-body font-semibold text-brand-text"
                    aria-haspopup="dialog"
                    onClick={() => setTakeoverSheetOpen(true)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="15"
                      height="15"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    <span>{takeover ? t(takeover) : tc("unknown")}</span>
                    <svg
                      viewBox="0 0 24 24"
                      width="13"
                      height="13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                </div>
                <div className="max-md:hidden">
                  <Segmented
                    ariaLabel={t("takeoverMode")}
                    options={takeoverOptions}
                    value={takeover ?? null}
                    disabled={pending}
                    className="w-full justify-stretch"
                    onChange={(mode) =>
                      void run(() => setMode({ mode }), false)
                    }
                  />
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2.5 rounded-[18px] border border-[color:color-mix(in_srgb,var(--border)_65%,transparent)] bg-card px-4 py-3.5 shadow-[0_1px_2px_oklch(0.55_0.08_60/0.04)]">
              <span className="text-label font-semibold text-muted-foreground">
                {tc("routingMode.title")}
              </span>
              <Segmented
                ariaLabel={tc("routingMode.title")}
                options={routingOptions}
                value={routingValue ?? null}
                disabled={pending}
                onChange={(mode) => void switchRouting(mode)}
              />
              {currentMode === "rule" ||
              currentMode === "global" ||
              currentMode === "direct" ? (
                <p className="m-0 text-label text-muted-foreground">
                  {t(`routingHint.${currentMode}`)}
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <section
          className={cn(
            cardSurface,
            "[grid-area:live] flex flex-col gap-3.5 py-5 px-[22px] max-md:p-[18px]",
          )}
          aria-label={t("trafficStats")}
        >
          <h2 className="text-subtitle font-semibold">{t("trafficStats")}</h2>
          <div className="grid min-h-[150px] grid-cols-[auto_minmax(0,1fr)_auto] items-stretch gap-6 max-md:grid-cols-1 max-md:gap-4">
            <div className="flex flex-col justify-center gap-[18px] pr-1 max-md:flex-row max-md:flex-wrap max-md:justify-start max-md:gap-x-7 max-md:gap-y-3.5">
              <div className="flex flex-col gap-0.5 max-md:flex-row max-md:items-center max-md:gap-3 max-md:flex-1 max-md:min-w-[130px]">
                <div
                  className="hidden max-md:grid max-md:size-11 max-md:shrink-0 max-md:place-items-center max-md:rounded-full max-md:bg-[oklch(0.54_0.16_153/12%)] max-md:text-success"
                  aria-hidden="true"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 4v14M6 12l6 6 6-6" />
                  </svg>
                </div>
                <div className="flex flex-col gap-px">
                  <span className="inline-flex items-center gap-1.5 text-label text-muted-foreground max-md:hidden">
                    <svg
                      className="inline-block align-middle text-brand max-md:hidden"
                      viewBox="0 0 24 24"
                      width="13"
                      height="13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 4v14M6 12l6 6 6-6" />
                    </svg>
                    {t("download")}
                  </span>
                  <b className="whitespace-nowrap text-title font-[650] tabular-nums">
                    {trafficState === "open" && speed
                      ? formatRate(speed.down)
                      : "—"}
                  </b>
                  <span className="hidden max-md:mt-px max-md:block max-md:text-label max-md:text-muted-foreground">
                    {t("download")}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-0.5 max-md:flex-row max-md:items-center max-md:gap-3 max-md:flex-1 max-md:min-w-[130px]">
                <div
                  className="hidden max-md:grid max-md:size-11 max-md:shrink-0 max-md:place-items-center max-md:rounded-full max-md:bg-[oklch(0.7163_0.1706_53.45/12%)] max-md:text-brand"
                  aria-hidden="true"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20V6M6 12l6-6 6 6" />
                  </svg>
                </div>
                <div className="flex flex-col gap-px">
                  <span className="inline-flex items-center gap-1.5 text-label text-muted-foreground max-md:hidden">
                    <svg
                      className="inline-block align-middle text-brand max-md:hidden"
                      viewBox="0 0 24 24"
                      width="13"
                      height="13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 20V6M6 12l6-6 6 6" />
                    </svg>
                    {t("upload")}
                  </span>
                  <b className="whitespace-nowrap text-title font-[650] tabular-nums">
                    {trafficState === "open" && speed
                      ? formatRate(speed.up)
                      : "—"}
                  </b>
                  <span className="hidden max-md:mt-px max-md:block max-md:text-label max-md:text-muted-foreground">
                    {t("upload")}
                  </span>
                </div>
              </div>
            </div>

            <TrafficChart
              samples={history}
              title={t("trafficHistory")}
              empty={t("collectingSamples")}
              windowLabel={t("recentWindow")}
              downloadLabel={t("download")}
              uploadLabel={t("upload")}
            />

            <div className="flex min-w-[170px] flex-col justify-center gap-4 border-l border-border pl-5 max-md:hidden">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  {t("sessionTotal")}
                </span>
                <b className="text-title font-[650] tabular-nums">
                  {sessionTotal !== null ? formatTraffic(sessionTotal) : "—"}
                </b>
                {connectionState !== "open" && (
                  <span className="text-label text-muted-foreground">
                    {r(connectionState)}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  {t("quota.remaining")}
                </span>
                {sub && quota ? (
                  <>
                    <b className="text-title font-[650] tabular-nums">
                      {formatTraffic(quota.remaining)}{" "}
                      <i className="text-body font-medium not-italic text-muted-foreground">
                        / {formatTraffic(sub.total)}
                      </i>
                    </b>
                    <span
                      className="mt-1.5 block h-2 overflow-hidden rounded-full bg-inset"
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(quotaPercent ?? 0)}
                      aria-label={t("quota.remaining")}
                    >
                      <span
                        className="block h-full w-full origin-left rounded-full bg-brand [transition:transform_var(--duration-base)_var(--ease-out-expo)] motion-reduce:[transition:none]"
                        style={{
                          transform: `scaleX(${(quotaPercent ?? 0) / 100})`,
                        }}
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
              </div>
            </div>
          </div>

          {/* Mobile-only config row under speeds */}
          <div className="hidden max-md:mt-3.5 max-md:flex max-md:items-center max-md:gap-2.5 max-md:border-t max-md:border-[color:color-mix(in_srgb,var(--border)_70%,transparent)] max-md:pt-3.5 max-md:text-body max-md:text-muted-foreground">
            <span
              className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-inset text-muted-foreground"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
            </span>
            <span className="min-w-0 flex-1 truncate">
              <b className="font-semibold text-foreground">
                {sub
                  ? sub.name
                  : hasLocalAPI
                    ? t("noConfig")
                    : t("noConfigRemote")}
              </b>
              {sub && quota && (
                <span>
                  {` · ${t("quota.remaining")} ${formatTraffic(quota.remaining)}`}
                </span>
              )}
            </span>
            {hasLocalAPI && (
              <Link
                to="/subscriptions"
                className="ml-auto grid size-6 place-items-center text-muted-foreground"
                aria-label={t("manage")}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            )}
          </div>
        </section>
      </div>

      {/* 首次打開才掛載，避免常駐離屏層（Sheet 常駐會殘留 aria 節點）。 */}
      {pickerOpen && (
        <NodePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          groups={available}
          focusGroupName={group?.name ?? null}
          onFocusGroup={setFocusGroup}
          chain={chain}
          nodeDelay={nodeDelay}
          selection={nodeSelection}
          onSelect={async (groupName, nodeName) => {
            setFocusGroup(groupName);
            await nodeSelection.select(groupName, nodeName);
          }}
        />
      )}

      {/* 流動端接管方式面板：桌面用分段滑塊，手機開底部面板（能力與原因相同）。 */}
      {takeoverSheetOpen && (
        <Sheet
          open
          onOpenChange={(sheetOpen) => {
            if (!sheetOpen) setTakeoverSheetOpen(false);
          }}
        >
          <SheetContent
            side="right"
            showCloseButton={false}
            aria-describedby={undefined}
            className="w-[340px] max-w-full overflow-y-auto sm:max-w-[340px]"
          >
            <div
              className="flex flex-col gap-3.5 py-5 px-[18px]"
              role="dialog"
              aria-modal="true"
              aria-label={t("takeoverMode")}
            >
              <header className="flex items-center justify-between">
                <SheetTitle asChild>
                  <h3 className="text-base font-semibold">
                    {t("takeoverMode")}
                  </h3>
                </SheetTitle>
                <button
                  type="button"
                  className="cursor-pointer rounded-sm px-1.5 py-1 text-body font-semibold text-brand-text"
                  onClick={() => setTakeoverSheetOpen(false)}
                  aria-label={tc("close")}
                >
                  ✕
                </button>
              </header>
              <div className="flex flex-col gap-2">
                {takeoverOptions.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 rounded-[14px] border border-border bg-card px-3.5 py-3 text-left text-foreground enabled:hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-55",
                      takeover === option.value &&
                        "border-transparent bg-brand-soft",
                    )}
                    disabled={pending || option.disabledReason !== undefined}
                    title={option.disabledReason}
                    onClick={() =>
                      void run(() => setMode({ mode: option.value }), false)
                    }
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <b className="text-sm font-semibold">{option.label}</b>
                      <span className="text-label text-muted-foreground">
                        {st(`takeover.${option.value}Desc` as const)}
                      </span>
                    </span>
                    {takeover === option.value && (
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 text-brand-text"
                        aria-hidden="true"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
