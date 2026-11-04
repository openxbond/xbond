import { formatRate } from "@xbond/client/activity";
import { formatTraffic } from "@xbond/client/helper";
import type { Snapshot } from "@xbond/client/request";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { useIsServiceConnected } from "@/components/disconnected-state";
import { Header } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStreamReader, useStreamState } from "@/hooks/use-core-stream";
import { useCapabilities } from "@/state/core-settings";

import Connections from "./connections/connections-page";
import Logs from "./logs/logs-page";

export default function Activity() {
  const { t: sb, i18n } = useTranslation("sidebar");
  const { t: r } = useTranslation("runtime");
  const { t: ov } = useTranslation("overview");
  const { t: tc } = useTranslation("common");
  const { isConnected, isLoading } = useIsServiceConnected();
  const caps = useCapabilities();
  const [params, setParams] = useSearchParams();
  const activeTab =
    params.get("view") === "connections" ? "connections" : "logs";
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
  return (
    <Tabs
      value={activeTab}
      onValueChange={select}
      dir={i18n.dir()}
      className="page gap-[22px]"
    >
      <Header title={sb("activity")}>
        <Badge
          variant={isConnected ? "default" : "outline"}
          className="tabular-nums font-normal"
        >
          {isLoading ? tc("loading") : isConnected ? r(state) : tc("stopped")}
        </Badge>
      </Header>
      <dl className="flex flex-wrap gap-x-10 gap-y-7 rounded-card border border-border bg-card p-6 max-md:gap-x-7 max-md:gap-y-[22px]">
        <div className="flex flex-col gap-2.5">
          <dt className="text-xs text-muted-foreground">{ov("upload")}</dt>
          <dd className="text-xl font-medium tabular-nums max-md:text-subtitle">
            {state === "open" ? formatRate(speed.up) : "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-2.5">
          <dt className="text-xs text-muted-foreground">{ov("download")}</dt>
          <dd className="text-xl font-medium tabular-nums max-md:text-subtitle">
            {state === "open" ? formatRate(speed.down) : "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-2.5">
          <dt className="text-xs text-muted-foreground">{sb("connections")}</dt>
          <dd className="text-xl font-medium tabular-nums max-md:text-subtitle">
            {connectionState === "open"
              ? (snapshot?.connections.length ?? "—")
              : "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-2.5">
          <dt className="text-xs text-muted-foreground">{ov("total")}</dt>
          <dd className="text-xl font-medium tabular-nums max-md:text-subtitle">
            {connectionState === "open" && snapshot
              ? formatTraffic(snapshot.uploadTotal + snapshot.downloadTotal)
              : "—"}
          </dd>
        </div>
        {caps.memory && (
          <div className="flex flex-col gap-2.5">
            <dt className="text-xs text-muted-foreground">{ov("memory")}</dt>
            <dd className="text-xl font-medium tabular-nums max-md:text-subtitle">
              {memoryBytes === null ? "—" : formatTraffic(memoryBytes)}
            </dd>
          </div>
        )}
      </dl>
      <TabsList aria-label={sb("activity")} className="max-md:w-full">
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
      <div className="min-w-0 w-full min-h-0 flex-1 [&_[role=tabpanel]]:h-full [&_.page]:p-0 [&_.page]:gap-3 [&_.page]:h-full [&_.page]:min-h-0 [&_.header]:m-0 [&_.header]:flex-wrap [&_.header]:gap-3 [&_.header_h1]:text-base [&_.connections-filter]:max-md:ml-0 [&_.connections-card]:max-md:min-h-[360px] [&_.log-table]:overflow-hidden [&_.log-table]:rounded-xl">
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
