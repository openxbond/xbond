import { useState } from "react";

import { useAction } from "@/hooks/use-action";
import { useClient } from "@/state/controller-target";
import { useLocalAPI } from "@/state/local-runtime";
import { useConfig } from "@/state/user-preferences";

import { useProxy } from "./proxy-data";

/** 與 NodePicker 的 SelectionResult 同義；select 完成後不會是 "idle"。 */
export type SelectResult = "success" | "failed" | "partial";

export function useNodeSelection() {
  const client = useClient();
  const { data: preferences } = useConfig();
  const { hasLocalAPI, selectNode } = useLocalAPI();
  const { markProxySelected, update } = useProxy();
  const { run, pending } = useAction();
  const [result, setResult] = useState<
    "idle" | "success" | "failed" | "partial"
  >("idle");
  // 返回結果讓調用方決定後續（如關閉抽屜、提示文案），不必事後讀 state。
  async function select(group: string, name: string): Promise<SelectResult> {
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
    const outcome: SelectResult = ok
      ? "success"
      : applied
        ? "partial"
        : "failed";
    setResult(outcome);
    return outcome;
  }
  return { select, pending, result };
}
