import { Button, Drawer, Header, success } from "@components";
import { CopyButton } from "@components/CopyButton";
import { useAction } from "@lib/actions";
import { useNodeSelection } from "@lib/node-selection";
import { proxyEndpoint, proxyTerminalCommand } from "@lib/proxy-endpoint";
import {
  useAPIInfo,
  useCapabilities,
  useClient,
  useGeneral,
  useLanguage,
  useLocalAPI,
  useProxy,
  useProxyMapping,
  useVersion,
  useStreamReader,
  useStreamState,
  identityAtom,
} from "@stores";
import { formatRate } from "@xbond/client/activity";
import { formatTraffic } from "@xbond/client/helper";
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

import "./style.scss";

interface TrafficSample {
  up: number;
  down: number;
  at: number;
}

/** 即時走勢：真面積圖，資料不足如實顯示取樣提示。 */
function TrafficChart({
  samples,
  title,
  empty,
  downloadLabel,
  uploadLabel,
}: {
  samples: TrafficSample[];
  title: string;
  empty: string;
  downloadLabel: string;
  uploadLabel: string;
}) {
  if (samples.length < 2) return <p className="chart-empty">{empty}</p>;
  const maximum = Math.max(
    1,
    ...samples.flatMap((sample) => [sample.up, sample.down]),
  );
  const linePath = (direction: "up" | "down") =>
    samples
      .map(
        (sample, index) =>
          `${index ? "L" : "M"}${(index / (samples.length - 1)) * 600},${
            160 - (sample[direction] / maximum) * 140
          }`,
      )
      .join("");
  return (
    <div className="live-chart">
      <div className="live-chart-legend">
        <span className="legend-item download">
          <span className="dot" /> {downloadLabel}
        </span>
        <span className="legend-item upload">
          <span className="dot" /> {uploadLabel}
        </span>
        <span className="peak-rate">{formatRate(maximum)}</span>
      </div>
      <svg viewBox="0 0 600 170" preserveAspectRatio="none" aria-label={title}>
        <title>{title}</title>
        <defs>
          <linearGradient id="live-download-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--info)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--info)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d="M0 40h600M0 90h600M0 140h600" className="chart-grid" />
        <path
          d={`${linePath("down")} L600,170 L0,170 Z`}
          fill="url(#live-download-fill)"
        />
        <path d={linePath("down")} className="download-line" />
        <path d={linePath("up")} className="upload-line" />
      </svg>
    </div>
  );
}

function latencyClass(delay: number) {
  if (delay < 150) return "is-fast";
  if (delay <= 400) return "is-mid";
  return "is-slow";
}

const focusAtom = atomWithStorage<Record<string, string>>(
  "xbond_focus_groups.v3",
  {},
);

export default function Connect() {
  const { lang } = useLanguage();
  const { t } = useTranslation("connect");
  const { t: r } = useTranslation("runtime");
  const { t: tc } = useTranslation("common");
  const { t: sb } = useTranslation("sidebar");
  const { t: px } = useTranslation("proxies");
  const { t: st } = useTranslation("settings");
  const controller = useAPIInfo();
  const client = useClient();
  const { general, update } = useGeneral();
  const caps = useCapabilities();
  const version = useVersion();
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
  const [pickerGroupName, setPickerGroupName] = useState<string | null>(null);
  const [pendingNode, setPendingNode] = useState<string | null>(null);

  const available = general.mode.toLowerCase() === "global" ? [global] : groups;
  const focusKey = controllerIdentity(controller.id, controller.url);
  const group = focusedGroup(available, focus[focusKey]);
  const chain = strategyPath(group, mapping);
  const pickerGroup =
    available.find((item) => item.name === pickerGroupName) ?? group;

  const traffic = useStreamReader<{ up: number; down: number }>("traffic");
  const trafficState = useStreamState(traffic);
  const connections = useStreamReader<Snapshot>("connections");
  const connectionState = useStreamState(connections);
  const memory = useStreamReader<{ inuse: number }>(
    caps.memory ? "memory" : null,
  );
  const [speed, setSpeed] = useState<{ up: number; down: number } | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [memoryBytes, setMemoryBytes] = useState<number | null>(null);
  const [history, setHistory] = useState<TrafficSample[]>([]);

  useEffect(() => {
    const onData = (items: { inuse: number }[]) =>
      setMemoryBytes(items.at(-1)?.inuse ?? null);
    memory.subscribe("data", onData);
    return () => memory.unsubscribe("data", onData);
  }, [memory]);

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
  const proxyAddress = proxyEndpoint(
    hasLocalAPI,
    controller.hostname,
    mixedPort,
  );

  // Latest known delay for a node, from the same history the proxies page reads.
  const nodeDelay = (name: string) => {
    const item = mapping.get(name);
    if (!item || !("history" in item)) return null;
    const last = item.history[item.history.length - 1];
    return last && last.delay > 0 ? last.delay : null;
  };

  const stateWord = hasLocalAPI
    ? running
      ? t("connected")
      : t("stopped")
    : r(trafficState);
  const stateNote = hasLocalAPI
    ? running
      ? t("uptime", { duration: status?.engine.uptime || "0m" })
      : sub
        ? t("readyToConnect")
        : t("noConfig")
    : t("remoteNote");

  const facts = [
    {
      ok: status?.threeTier.coreReachable || active,
      label: t("tiers.core"),
      value: hasLocalAPI
        ? status?.engine.running
          ? version.version || "mihomo"
          : t("stopped")
        : r(trafficState),
    },
    {
      ok: status?.threeTier.trafficIntercepted,
      label: t("tiers.takeover"),
      value: takeover ? t(takeover) : tc("unknown"),
    },
    {
      ok: status?.threeTier.egressVerified,
      label: t("tiers.egress"),
      value: status?.threeTier.egressVerified
        ? status.threeTier.egressLatencyMs > 0
          ? `${status.threeTier.egressLatencyMs}ms`
          : t("egressVerified")
        : tc("unknown"),
    },
  ];

  const currentDelay = group?.now ? nodeDelay(group.now) : null;
  const quotaPercent =
    sub && quota ? Math.max(0, Math.min(100, quota.remainingPercent)) : null;

  function copyTerminalCommand() {
    const cmd = proxyTerminalCommand("powershell", proxyAddress);
    navigator.clipboard.writeText(cmd).then(() => {
      success(tc("copied"));
    });
  }

  async function pickNode(name: string) {
    if (!pickerGroup) return;
    setPendingNode(name);
    try {
      await nodeSelection.select(pickerGroup.name, name);
    } finally {
      setPendingNode(null);
    }
  }

  function openPicker() {
    setPickerGroupName(group?.name ?? null);
    setPickerOpen(true);
  }

  return (
    <div className="page connect-page">
      <Header title={sb("home")}>
        <div className="home-header-badge">
          <span className={`status-dot ${active ? "online" : ""}`} />
          <span className="text-sm font-medium">
            {isLocalTarget ? tc("local") : tc("remote")} ·{" "}
            {controller.name || new URL(controller.url).hostname}
          </span>
        </div>
      </Header>

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

      {/* 非對稱控制台：左側連線儀器，右側即時儀表 */}
      <div className="console">
        <section className="console-control" aria-label={t("connect")}>
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
              {pending ? (
                <span className="orb-spinner" aria-hidden="true" />
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="36"
                  height="36"
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
                width="32"
                height="32"
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
              <li key={fact.label} className={fact.ok ? "ok" : ""}>
                <span className="fact-dot" aria-hidden="true" />
                {fact.label} <b>{fact.value}</b>
              </li>
            ))}
          </ul>

          {group ? (
            <button type="button" className="node-chip" onClick={openPicker}>
              <span className="node-chip-label">
                {t("via")} <b>{group.now || t("strategy.noNodeSelected")}</b>
              </span>
              {currentDelay && (
                <span className={`node-latency ${latencyClass(currentDelay)}`}>
                  {currentDelay}ms
                </span>
              )}
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
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          ) : (
            <Link to="/proxies" className="text-btn">
              {sb("proxies")} →
            </Link>
          )}

          <div className="dial-meta">
            <span className="address-chip">
              <code>{proxyAddress}</code>
              <CopyButton value={proxyAddress} label={tc("copy")} />
            </span>
            <button
              type="button"
              className="text-btn"
              onClick={copyTerminalCommand}
            >
              {t("copyProxyCommand")}
            </button>
          </div>

          <div className="dial-modes">
            {hasLocalAPI && (
              <div
                className="segmented-control"
                role="group"
                aria-label={t("takeoverMode")}
              >
                {(["sysproxy", "tun", "port"] as const).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    className={`segment-btn ${takeover === mode ? "active" : ""}`}
                    disabled={pending}
                    title={st(`takeover.${mode}Desc` as const)}
                    onClick={() => void run(() => setMode({ mode }))}
                  >
                    {t(mode)}
                  </button>
                ))}
              </div>
            )}
            <div
              className="segmented-control"
              role="group"
              aria-label={tc("routingMode.title")}
            >
              {(["rule", "global", "direct"] as const).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={`segment-btn ${currentMode === mode ? "active" : ""}`}
                  disabled={pending}
                  onClick={() =>
                    void run(async () => {
                      if (hasLocalAPI) {
                        await setMode({ routing: mode });
                      } else {
                        await client.updateConfig({ mode });
                        await update();
                      }
                    })
                  }
                >
                  {tc(`routingMode.${mode}`)}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="console-live" aria-label={t("compass")}>
          <div className="live-numbers">
            <div className="live-number">
              <span className="glance-value">
                {trafficState === "open" && speed
                  ? formatRate(speed.down)
                  : "—"}
              </span>
              <span className="glance-label">{t("download")}</span>
            </div>
            <div className="live-number">
              <span className="glance-value">
                {trafficState === "open" && speed ? formatRate(speed.up) : "—"}
              </span>
              <span className="glance-label">{t("upload")}</span>
            </div>
            <div className="live-number">
              <span className="glance-value">
                {connectionState === "open" && snapshot
                  ? snapshot.connections.length
                  : 0}
              </span>
              <span className="glance-label">
                {t("activeConnections")}
                {caps.memory && memoryBytes
                  ? ` · ${t("memory")} ${formatTraffic(memoryBytes)}`
                  : ""}
              </span>
            </div>
          </div>

          <TrafficChart
            samples={history}
            title={t("trafficHistory")}
            empty={t("collectingSamples")}
            downloadLabel={t("download")}
            uploadLabel={t("upload")}
          />

          {sub && quota ? (
            <div className="quota-bar-row">
              <div className="quota-bar">
                <div
                  className="quota-bar-fill"
                  style={{ width: `${quotaPercent ?? 0}%` }}
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(quotaPercent ?? 0)}
                  aria-label={t("quota.remaining")}
                />
              </div>
              <span className="quota-bar-text">
                {t("quota.remaining")} <b>{formatTraffic(quota.remaining)}</b> ·{" "}
                {t("used")} {formatTraffic(quota.used)} /{" "}
                {formatTraffic(sub.total)}
                {sub.expire > 0
                  ? ` · ${t("expiry")} ${new Date(sub.expire * 1000).toLocaleDateString(lang.replace("_", "-"))}`
                  : ""}
              </span>
            </div>
          ) : sub ? (
            <div className="quota-bar-row">
              <p className="quota-bar-text">{t("quota.unknown")}</p>
              <p className="quota-bar-text">{t("quota.unknownDesc")}</p>
            </div>
          ) : hasLocalAPI ? (
            <Link to="/subscriptions" className="quota-import-link">
              {t("importConfig")} →
            </Link>
          ) : (
            <p className="quota-bar-text">{t("noConfigRemote")}</p>
          )}
        </section>
      </div>

      <footer className="dial-links">
        <Link to="/diagnostics" className="text-btn">
          {sb("diagnostics")}
        </Link>
        <Link to="/connections" className="text-btn">
          {t("quickLinks.connections")}
        </Link>
        <Link to="/rules" className="text-btn">
          {t("quickLinks.rules")}
        </Link>
        <Link to="/logs" className="text-btn">
          {t("quickLinks.logs")}
        </Link>
      </footer>

      {/* 節點切換抽屜：首次打開才掛載，避免常駐離屏層 */}
      {pickerOpen && (
        <Drawer
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          width={360}
        >
          <div className="node-picker">
            <header className="picker-head">
              <h3>{t("strategy.title")}</h3>
              <button
                type="button"
                className="text-btn"
                onClick={() => setPickerOpen(false)}
                aria-label={tc("close")}
              >
                ✕
              </button>
            </header>

            {available.length > 1 && (
              <div className="picker-groups">
                {available.map((item) => (
                  <button
                    type="button"
                    key={item.name}
                    aria-pressed={pickerGroup?.name === item.name}
                    className={`picker-group-chip ${pickerGroup?.name === item.name ? "active" : ""}`}
                    onClick={() => {
                      setPickerGroupName(item.name);
                      setFocus((previous) => ({
                        ...previous,
                        [focusKey]: item.name,
                      }));
                    }}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}

            {pickerGroup ? (
              <>
                <p className="picker-chain">
                  {chain.join(" → ") || pickerGroup.name}
                </p>
                <ul className="picker-nodes">
                  {pickerGroup.all.map((name) => {
                    const delay = nodeDelay(name);
                    const selected = pickerGroup.now === name;
                    return (
                      <li key={name}>
                        <button
                          type="button"
                          className={`picker-node-row ${selected ? "selected" : ""}`}
                          disabled={
                            pickerGroup.type !== "Selector" ||
                            pendingNode !== null
                          }
                          onClick={() => void pickNode(name)}
                        >
                          <span className="node-name">{name}</span>
                          {pendingNode === name ? (
                            <span className="node-latency">
                              {px("switching")}
                            </span>
                          ) : delay ? (
                            <span
                              className={`node-latency ${latencyClass(delay)}`}
                            >
                              {delay}ms
                            </span>
                          ) : null}
                          {selected && (
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
                      </li>
                    );
                  })}
                </ul>
                <footer className="picker-foot">
                  {(nodeSelection.pending ||
                    nodeSelection.result !== "idle") && (
                    <span
                      className={`node-switch-notice ${nodeSelection.result === "failed" ? "failed" : ""}`}
                      role="status"
                    >
                      {px(
                        nodeSelection.pending
                          ? "switching"
                          : nodeSelection.result === "success"
                            ? "switched"
                            : "switchFailed",
                      )}
                    </span>
                  )}
                </footer>
              </>
            ) : (
              <p className="dial-empty">{t("noGroup")}</p>
            )}
          </div>
        </Drawer>
      )}
    </div>
  );
}
