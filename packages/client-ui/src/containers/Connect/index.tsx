import { Button, CountryFlag, Drawer, Segmented } from "@components";
import { nodeFlagCode, stripFlagEmoji } from "@components/CountryFlag";
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
import { useAtom, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { TrafficChart, type TrafficSample } from "./chart";
import { NodePicker, latencyClass } from "./NodePicker";

import "./style.scss";

const focusAtom = atomWithStorage<Record<string, string>>(
  "xbond_focus_groups.v3",
  {},
);

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
    <div className="page connect-page">
      {localConfig && !status && (
        <div className="status-notice" role={localError ? "alert" : "status"}>
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

      <div className="console">
        <section
          className="console-control card-surface"
          aria-label={t("connect")}
        >
          {hasLocalAPI ? (
            <button
              type="button"
              className={`orb ${active ? "is-on" : "is-off"}`}
              disabled={pending || (!running && !sub)}
              aria-pressed={active}
              aria-label={`${stateWord} — ${running ? t("disconnect") : t("connect")}`}
              onClick={() => void run(() => (running ? down() : up()), false)}
            >
              <span className="orb-ring" aria-hidden="true" />
              <span className="orb-halo" aria-hidden="true" />
              {pending ? (
                <span className="orb-spinner" aria-hidden="true" />
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
              className="orb is-remote"
              aria-label={t("manageController")}
              onClick={() => setIdentity(false)}
            >
              <span className="orb-ring" aria-hidden="true" />
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
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </button>
          )}

          <h2 className="dial-state">{stateWord}</h2>
          <p className="dial-note">{stateNote}</p>
          {uptimeClock && (
            <p
              className="dial-uptime"
              aria-label={t("uptime", { duration: uptimeClock })}
            >
              {uptimeClock}
            </p>
          )}
          {!hasLocalAPI && (
            <button
              type="button"
              className="text-btn"
              onClick={() => setIdentity(false)}
            >
              {t("manageController")}
            </button>
          )}

          <ul className="dial-facts">
            {facts.map((fact) => (
              <li key={fact.kind} className={`fact fact-${fact.tone}`}>
                <span className="fact-head">
                  <FactIcon kind={fact.kind} />
                  {fact.label}
                </span>
                <span className="fact-value">
                  <span className="fact-dot" aria-hidden="true" />
                  <b>{fact.value}</b>
                </span>
              </li>
            ))}
          </ul>

          <div className="config-row desktop-config-row">
            <span className="config-row-icon" aria-hidden="true">
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
              <span className="config-row-text">
                {t("currentConfig")} <b>{sub.name}</b>
              </span>
            ) : (
              <span className="config-row-text">{t("noConfig")}</span>
            )}
            {hasLocalAPI && (
              <Link to="/subscriptions" className="config-row-link">
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

        <div className="console-aside">
          <section
            className="console-node card-surface"
            aria-label={t("currentNode")}
          >
            <h2>{t("currentNode")}</h2>
            <button
              type="button"
              className="node-row"
              onClick={() => setPickerOpen(true)}
              aria-haspopup="dialog"
            >
              <span className="node-row-flag" aria-hidden="true">
                {nodeFlag ? (
                  <CountryFlag code={nodeFlag} className="node-flag" />
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
              <span className="node-row-text">
                <span className="node-row-caption">{t("nodeSelection")}</span>
                <span className="node-row-name">
                  {group?.now
                    ? nodeFlag
                      ? stripFlagEmoji(group.now)
                      : group.now
                    : t("strategy.noNodeSelected")}
                </span>
                <span className="node-row-meta">
                  {currentDelay ? (
                    <>
                      <b
                        className={`node-latency ${latencyClass(currentDelay)}`}
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
              <span className="node-row-chevron" aria-hidden="true">
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
            className="console-preferences card-surface"
            aria-label={t("prefs")}
          >
            <h2>{t("prefs")}</h2>
            {hasLocalAPI && (
              <div className="pref-card">
                <div className="pref-head">
                  <span className="pref-label">{t("takeoverMode")}</span>
                  <button
                    type="button"
                    className="pref-mobile-trigger"
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
                <div className="pref-desktop-only">
                  <Segmented
                    ariaLabel={t("takeoverMode")}
                    options={takeoverOptions}
                    value={takeover ?? null}
                    disabled={pending}
                    onChange={(mode) =>
                      void run(() => setMode({ mode }), false)
                    }
                  />
                </div>
              </div>
            )}
            <div className="pref-card">
              <span className="pref-label">{tc("routingMode.title")}</span>
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
                <p className="pref-hint">{t(`routingHint.${currentMode}`)}</p>
              ) : null}
            </div>
          </section>
        </div>

        <section
          className="console-live card-surface"
          aria-label={t("trafficStats")}
        >
          <h2>{t("trafficStats")}</h2>
          <div className="live-grid">
            <div className="live-speeds">
              <div className="live-speed down">
                <div className="speed-icon-circle down" aria-hidden="true">
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
                <div className="speed-info">
                  <span className="speed-head down">
                    <svg
                      className="speed-inline-arrow"
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
                  <b className="speed-value">
                    {trafficState === "open" && speed
                      ? formatRate(speed.down)
                      : "—"}
                  </b>
                  <span className="speed-sublabel">{t("download")}</span>
                </div>
              </div>
              <div className="live-speed up">
                <div className="speed-icon-circle up" aria-hidden="true">
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
                <div className="speed-info">
                  <span className="speed-head up">
                    <svg
                      className="speed-inline-arrow"
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
                  <b className="speed-value">
                    {trafficState === "open" && speed
                      ? formatRate(speed.up)
                      : "—"}
                  </b>
                  <span className="speed-sublabel">{t("upload")}</span>
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

            <div className="live-totals">
              <div className="totals-block">
                <span className="totals-label">{t("sessionTotal")}</span>
                <b className="totals-value">
                  {sessionTotal !== null ? formatTraffic(sessionTotal) : "—"}
                </b>
                {connectionState !== "open" && (
                  <span className="totals-stale">{r(connectionState)}</span>
                )}
              </div>
              <div className="totals-block quota-block">
                <span className="totals-label">{t("quota.remaining")}</span>
                {sub && quota ? (
                  <>
                    <b className="totals-value">
                      {formatTraffic(quota.remaining)}{" "}
                      <i>/ {formatTraffic(sub.total)}</i>
                    </b>
                    <span
                      className="quota-strip"
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(quotaPercent ?? 0)}
                      aria-label={t("quota.remaining")}
                    >
                      <span
                        className="quota-strip-fill"
                        style={{
                          transform: `scaleX(${(quotaPercent ?? 0) / 100})`,
                        }}
                      />
                    </span>
                  </>
                ) : (
                  <span className="totals-stale">
                    {sub ? t("quota.unknown") : t("noConfig")}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Mobile-only config row under speeds */}
          <div className="mobile-config-row">
            <span className="mobile-config-icon" aria-hidden="true">
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
            <span className="mobile-config-text">
              <b>{sub ? sub.name : t("noConfig")}</b>
              {sub && quota && (
                <span className="mobile-config-quota">
                  {` · ${t("quota.remaining")} ${formatTraffic(quota.remaining)}`}
                </span>
              )}
            </span>
            {hasLocalAPI && (
              <Link
                to="/subscriptions"
                className="mobile-config-link"
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

      {/* 首次打開才掛載，避免常駐離屏層（Drawer 常駐會殘留 aria 節點）。 */}
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
        <Drawer visible onClose={() => setTakeoverSheetOpen(false)} width={340}>
          <div
            className="takeover-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t("takeoverMode")}
          >
            <header className="picker-head">
              <h3>{t("takeoverMode")}</h3>
              <button
                type="button"
                className="text-btn"
                onClick={() => setTakeoverSheetOpen(false)}
                aria-label={tc("close")}
              >
                ✕
              </button>
            </header>
            <div className="takeover-options">
              {takeoverOptions.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={`takeover-option ${takeover === option.value ? "selected" : ""}`}
                  disabled={pending || option.disabledReason !== undefined}
                  title={option.disabledReason}
                  onClick={() =>
                    void run(() => setMode({ mode: option.value }), false)
                  }
                >
                  <span className="takeover-option-text">
                    <b>{option.label}</b>
                    <span>{st(`takeover.${option.value}Desc` as const)}</span>
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
                      className="picker-check"
                      aria-hidden="true"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
}
