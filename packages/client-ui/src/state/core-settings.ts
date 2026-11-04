import { coreCapabilities } from "@xbond/client/capabilities";
import useSWR from "swr";

import { useClient } from "./controller-target";

const emptyVersion = { version: "", premium: false, meta: false };
export function useVersion() {
  const client = useClient();
  const result = useSWR(
    ["/version", client],
    async () => {
      const { data } = await client.getVersion();
      return {
        version: data.version || "",
        premium: !!data.premium,
        meta: !!data.meta,
      };
    },
    { shouldRetryOnError: false },
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
  const result = useSWR(["/configs", client], async () => {
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
