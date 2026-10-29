import { useAction } from "@lib/actions";
import { useClient, useConfig, useLocalAPI, useProxy } from "@stores";
import { useState } from "react";

export function useNodeSelection() {
  const client = useClient();
  const { data: preferences } = useConfig();
  const { hasLocalAPI, selectNode } = useLocalAPI();
  const { markProxySelected, update } = useProxy();
  const { run, pending } = useAction();
  const [selectedName, setSelectedName] = useState("");
  const [result, setResult] = useState<
    "idle" | "success" | "failed" | "partial"
  >("idle");
  async function select(group: string, name: string) {
    let applied = false;
    setSelectedName(name);
    setResult("idle");
    const ok = await run(async () => {
      if (hasLocalAPI) await selectNode(group, name);
      else await client.changeProxySelected(group, name);
      applied = true;
      markProxySelected(group, name);
      await update();
      if (preferences.breakConnections) {
        const snapshot = await client.getConnections();
        await Promise.all(
          snapshot.data.connections
            .filter((connection) => connection.chains.includes(group))
            .map((connection) => client.closeConnection(connection.id)),
        );
      }
    }, false);
    setResult(ok ? "success" : applied ? "partial" : "failed");
  }
  return { select, pending, selectedName, result };
}
