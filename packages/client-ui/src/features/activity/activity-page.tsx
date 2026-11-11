import { formatRate } from "@xbond/client/activity";
import { formatTraffic } from "@xbond/client/helper";
import type { Snapshot } from "@xbond/client/request";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { Header } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Rules from "@/features/rules/rules-page";
import { useStreamReader, useStreamState } from "@/hooks/use-core-stream";
import { useIsMobile } from "@/platform/host";
import { useCapabilities } from "@/state/core-settings";

import Connections from "./connections/connections-page";
import Logs from "./logs/logs-page";

export default function Activity() {
  const { t: sb, i18n } = useTranslation("sidebar");
  const { t: ov } = useTranslation("overview");
  const isMobile = useIsMobile();
  const caps = useCapabilities();
  const [params, setParams] = useSearchParams();
  const rawView = params.get("view");
  const activeTab = ["connections", "logs", "rules"].includes(rawView ?? "")
    ? (rawView as string)
    : "connections";
  const traffic = useStreamReader<{ up: number; down: number }>("traffic");
  const state = useStreamState(traffic);
  const connections = useStreamReader<Snapshot>("connections");
  const connectionState = useStreamState(connections);
  const memory = useStreamReader<{ inuse: number }>(
    caps.memory ? "memory" : null,
  );
  const [speed, setSpeed] = useState({ up: 0, down: 0 });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [memoryBytes, setMemoryBytes] = useState<number | null>(null);
  useEffect(() => {
    const onData = (items: { up: number; down: number }[]) => {
      const item = items.at(-1);
      if (item) setSpeed(item);
    };
    traffic.subscribe("data", onData);
    return () => traffic.unsubscribe("data", onData);
  }, [traffic]);
  useEffect(() => {
    const onData = (items: Snapshot[]) => setSnapshot(items.at(-1) ?? null);
    connections.subscribe("data", onData);
    return () => connections.unsubscribe("data", onData);
  }, [connections]);
  useEffect(() => {
    const onData = (items: { inuse: number }[]) =>
      setMemoryBytes(items.at(-1)?.inuse ?? null);
    memory.subscribe("data", onData);
    return () => memory.unsubscribe("data", onData);
  }, [memory]);
  function select(view: string) {
    setParams(
      (previous) => {
        previous.set("view", view);
        return previous;
      },
      { replace: true },
    );
  }

  // 手機「動態」頁：頂行緊湊實時摘要 + 連接 | 日誌 | 規則 三段切換，
  // 子視圖不再各自渲染一級頁頭。
  if (isMobile) {
    const activeCount = Array.isArray(snapshot?.connections)
      ? snapshot.connections.length
      : null;
    return (
      <div className="flex w-full min-w-0 flex-col gap-3 px-4 pt-2 pb-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-title font-bold tracking-tight text-foreground">
            {sb("activity")}
          </h1>
          {/* 緊湊實時摘要：下行 · 上行 · 活動連接數；斷流時整體退為「—」。 */}
          <p
            className="truncate text-caption tabular-nums text-muted-foreground"
            aria-live="off"
          >
            {state === "open" ? (
              <>
                <span className="text-foreground">
                  ↓ {formatRate(speed.down)}
                </span>{" "}
                <span className="text-foreground">
                  ↑ {formatRate(speed.up)}
                </span>
                {activeTab === "connections" && activeCount !== null && (
                  <span> · {activeCount}</span>
                )}
              </>
            ) : (
              "—"
            )}
          </p>
        </div>
        <Tabs
          value={activeTab}
          onValueChange={select}
          dir={i18n.dir()}
          className="flex w-full min-w-0 flex-col gap-3"
        >
          <TabsList
            variant="line"
            aria-label={sb("activity")}
            className="w-full"
          >
            <TabsTrigger value="connections">{sb("connections")}</TabsTrigger>
            <TabsTrigger value="logs">{sb("logs")}</TabsTrigger>
            <TabsTrigger value="rules">{sb("rules")}</TabsTrigger>
          </TabsList>
          <div className="flex min-w-0 w-full flex-col [&_[role=tabpanel]]:min-w-0 [&_.page]:px-0 [&_.page]:pt-0">
            <TabsContent value="connections" className="m-0">
              <Connections mobile />
            </TabsContent>
            <TabsContent value="logs" className="m-0">
              <Logs embedded />
            </TabsContent>
            <TabsContent value="rules" className="m-0">
              <Rules embedded />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    );
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={select}
      dir={i18n.dir()}
      className="page gap-[22px]"
    >
      {/* 連線狀態由內嵌日誌／連接頁的頭部交代，頁級不再重複一枚徽章。 */}
      <Header title={sb("activity")} />
      <dl className="flex flex-wrap gap-x-10 gap-y-7 rounded-card border border-border bg-card p-6 max-md:gap-x-7 max-md:gap-y-[22px]">
        <div className="flex flex-col gap-2.5">
          <dt className="text-xs text-muted-foreground">{ov("upload")}</dt>
          <dd className="text-metric font-semibold tabular-nums max-md:text-subtitle">
            {state === "open" ? formatRate(speed.up) : "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-2.5">
          <dt className="text-xs text-muted-foreground">{ov("download")}</dt>
          <dd className="text-metric font-semibold tabular-nums max-md:text-subtitle">
            {state === "open" ? formatRate(speed.down) : "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-2.5">
          <dt className="text-xs text-muted-foreground">{sb("connections")}</dt>
          <dd className="text-metric font-semibold tabular-nums max-md:text-subtitle">
            {connectionState === "open"
              ? // 核心在零連接時回 null 而非 []：null 是 0 這個事實，
                // 只有快照缺席才是未知（traffic-overview 同此約定）。
                Array.isArray(snapshot?.connections)
                ? snapshot.connections.length
                : "—"
              : "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-2.5">
          <dt className="text-xs text-muted-foreground">{ov("total")}</dt>
          <dd className="text-metric font-semibold tabular-nums max-md:text-subtitle">
            {connectionState === "open" && snapshot
              ? formatTraffic(snapshot.uploadTotal + snapshot.downloadTotal)
              : "—"}
          </dd>
        </div>
        {caps.memory && (
          <div className="flex flex-col gap-2.5">
            <dt className="text-xs text-muted-foreground">{ov("memory")}</dt>
            <dd className="text-metric font-semibold tabular-nums max-md:text-subtitle">
              {memoryBytes === null ? "—" : formatTraffic(memoryBytes)}
            </dd>
          </div>
        )}
      </dl>
      <TabsList
        variant="line"
        aria-label={sb("activity")}
        // line 基樣式所有斷點 w-full；桌面兩個短標籤攤滿整行、中部大片死空間，
        // md 以上收攏內容寬左對齊，移動端保留等分鋪滿的觸控形態。
        className="w-full md:w-fit"
      >
        <TabsTrigger value="logs">{sb("logs")}</TabsTrigger>
        <TabsTrigger value="connections">{sb("connections")}</TabsTrigger>
      </TabsList>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/rules">{sb("rules")}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/diagnostics">{sb("diagnostics")}</Link>
        </Button>
      </div>
      <div className="flex min-h-0 min-w-0 w-full flex-1 [&_[role=tabpanel]]:h-full [&_.page]:p-0 [&_.page]:gap-3 [&_.page]:h-full [&_.page]:min-h-0 [&_.header]:m-0 [&_.header]:flex-wrap [&_.header]:gap-3 [&_.header_h1]:text-base [&_.connections-filter]:max-md:ml-0 [&_.connections-card]:max-md:min-h-[360px] [&_.log-table]:overflow-hidden [&_.log-table]:rounded-xl">
        <TabsContent value="logs" forceMount hidden={activeTab !== "logs"}>
          <Logs />
        </TabsContent>
        <TabsContent
          value="connections"
          forceMount
          hidden={activeTab !== "connections"}
        >
          <Connections />
        </TabsContent>
      </div>
    </Tabs>
  );
}
