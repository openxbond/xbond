import { Header, Card } from "@components";
import { RequestStatus } from "@components/RequestStatus";
import { formatTraffic } from "@lib/helper";
import type { Snapshot } from "@lib/request";
import {
  useAPIInfo,
  useGeneral,
  useStreamReader,
  useStreamState,
  useCapabilities,
} from "@stores";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface Traffic {
  up: number;
  down: number;
}
export default function Overview() {
  const { t } = useTranslation("overview");
  const { t: r } = useTranslation("runtime");
  const api = useAPIInfo();
  const { general, error, update } = useGeneral();
  const caps = useCapabilities();
  const traffic = useStreamReader<Traffic>("traffic");
  const connections = useStreamReader<Snapshot>("connections");
  const memory = useStreamReader<{ inuse: number }>(
    caps.memory ? "memory" : null,
  );
  const state = useStreamState(traffic);
  const connectionState = useStreamState(connections);
  const memoryState = useStreamState(memory);
  const [history, setHistory] = useState<Traffic[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [bytes, setBytes] = useState<number | undefined>();
  useEffect(() => {
    const onData = (items: Traffic[]) =>
      setHistory((previous) => [...previous, ...items].slice(-60));
    traffic.subscribe("data", onData);
    return () => traffic.unsubscribe("data", onData);
  }, [traffic]);
  useEffect(() => {
    const onData = (items: Snapshot[]) =>
      setSnapshot(items[items.length - 1] ?? null);
    connections.subscribe("data", onData);
    return () => connections.unsubscribe("data", onData);
  }, [connections]);
  useEffect(() => {
    const onData = (items: { inuse: number }[]) =>
      setBytes(items[items.length - 1]?.inuse);
    memory.subscribe("data", onData);
    return () => memory.unsubscribe("data", onData);
  }, [memory]);
  const latest = history[history.length - 1];
  const memoryBytes = bytes && bytes > 0 ? bytes : snapshot?.memory;
  const max = Math.max(1, ...history.flatMap((item) => [item.up, item.down]));
  const line = (key: keyof Traffic) =>
    history
      .map(
        (item, index) =>
          `${20 + (index / 59) * 760},${200 - (item[key] / max) * 180}`,
      )
      .join(" ");
  const stats = [
    [
      t("upload"),
      state === "open" && latest ? `${formatTraffic(latest.up)}/s` : "—",
    ],
    [
      t("download"),
      state === "open" && latest ? `${formatTraffic(latest.down)}/s` : "—",
    ],
    [
      t("uploaded"),
      connectionState === "open" && snapshot
        ? formatTraffic(snapshot.uploadTotal)
        : "—",
    ],
    [
      t("downloaded"),
      connectionState === "open" && snapshot
        ? formatTraffic(snapshot.downloadTotal)
        : "—",
    ],
    [
      t("connections"),
      connectionState === "open" && snapshot
        ? String(snapshot.connections?.length ?? 0)
        : "—",
    ],
    [t("mode"), general.mode || "—"],
    ...(caps.memory
      ? [
          [
            t("memory"),
            (memoryState === "open" || connectionState === "open") &&
            memoryBytes !== undefined
              ? formatTraffic(memoryBytes)
              : "—",
          ],
        ]
      : []),
  ];
  return (
    <div className="page">
      <Header title={t("title")}>
        <output className="text-sm text-muted-foreground">{r(state)}</output>
      </Header>
      <p className="my-3 break-all font-mono text-sm text-muted-foreground">
        {api.name || api.url}
      </p>
      <RequestStatus error={error} retry={update} />
      <Card>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-7 py-3 md:grid-cols-4">
          {stats.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-2 break-words font-mono text-lg tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
      <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{t("traffic")}</h2>
        <div className="flex gap-4 text-sm">
          <span className="text-success">{t("upload")}</span>
          <span className="text-info">{t("download")}</span>
        </div>
      </div>
      <Card className="min-h-60">
        <div className="text-xs tabular-nums text-muted-foreground">
          {formatTraffic(max)}/s
        </div>
        {history.length ? (
          <svg
            viewBox="0 0 800 220"
            aria-label={t("traffic")}
            className="w-full h-60"
          >
            <line x1="20" y1="200" x2="780" y2="200" stroke="var(--border)" />
            <polyline
              points={line("up")}
              fill="none"
              stroke="var(--success)"
              strokeWidth="2"
              strokeDasharray="5 3"
            />
            <polyline
              points={line("down")}
              fill="none"
              stroke="var(--info)"
              strokeWidth="2"
            />
          </svg>
        ) : (
          <p className="py-16 text-center text-muted-foreground">
            {t("noTraffic")}
          </p>
        )}
      </Card>
    </div>
  );
}
