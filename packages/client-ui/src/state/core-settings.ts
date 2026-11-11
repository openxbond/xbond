import { coreCapabilities } from "@xbond/client/capabilities";
import useSWR from "swr";

import { useClient } from "./controller-target";

const emptyVersion = { version: "", premium: false, meta: false };
export function useVersion() {
  const client = useClient();
  const result = useSWR(
    client ? ["/version", client] : null,
    async () => {
      if (!client) throw new Error("No core client");
      const { data } = await client.getVersion();
      return {
        version: data.version || "",
        premium: !!data.premium,
        meta: !!data.meta,
      };
    },
    // 允許出錯重試：核心常在頁面掛載之後才啟動（移動端尤其如此），首拉
    // 失敗後若禁重試，版本與 capabilities 會一直停在空態，關於卡顯示
    // 「Clash —」。本地回環上的重試代價可忽略。
  );
  return result.data ?? emptyVersion;
}

const emptyGeneral = {
  mode: "",
  modeList: undefined,
  allowLan: false,
  logLevel: undefined,
  port: undefined,
  socksPort: undefined,
  mixedPort: 0,
};
export function useGeneral() {
  const client = useClient();
  const result = useSWR(client ? ["/configs", client] : null, async () => {
    if (!client) throw new Error("No core client");
    const { data } = await client.getConfig();
    return {
      port: data.port,
      socksPort: data["socks-port"],
      mixedPort: data["mixed-port"] ?? 0,
      redirPort: data["redir-port"],
      mode: data.mode ?? "",
      modeList: data["mode-list"],
      logLevel: data["log-level"],
      allowLan: data["allow-lan"],
    };
  });
  return {
    general: result.data ?? emptyGeneral,
    update: result.mutate,
    error: result.error,
  };
}
export function useCapabilities() {
  const version = useVersion();
  const { general } = useGeneral();
  return coreCapabilities(version, general.modeList);
}
