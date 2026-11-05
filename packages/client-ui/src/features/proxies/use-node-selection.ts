import { useState } from "react";

import { useAction } from "@/hooks/use-action";
import { useClient } from "@/state/controller-target";
import { useLocalAPI } from "@/state/local-runtime";
import { useConfig } from "@/state/user-preferences";

import { useProxy } from "./proxy-data";

export function useNodeSelection() {
  const client = useClient();
  const { data: preferences } = useConfig();
  const { hasLocalAPI, selectNode } = useLocalAPI();
  const { markProxySelected, update } = useProxy();
  const { run, pending } = useAction();
  const [result, setResult] = useState<
    "idle" | "success" | "failed" | "partial"
  >("idle");
  async function select(group: string, name: string) {
    let applied = false;
    setResult("idle");
    const ok = await run(async () => {
      if (!client) throw new Error("LocalAPI not available");
      if (hasLocalAPI) await selectNode(group, name);
      else await client.changeProxySelected(group, name);
      applied = true;
      markProxySelected(group, name);
      await update();
      if (preferences.breakConnections) {
        const snapshot = await client.getConnections();
        // 核心在零连接时返回 null 而非 []：这里 throw 会把一次成功的节点
        // 切换误报成 partial（traffic-overview 对同字段做了同样防护）。
        await Promise.all(
          (snapshot.data.connections ?? [])
            .filter((connection) => connection.chains.includes(group))
            .map((connection) => client.closeConnection(connection.id)),
        );
      }
    }, false);
    setResult(ok ? "success" : applied ? "partial" : "failed");
  }
  return { select, pending, result };
}
