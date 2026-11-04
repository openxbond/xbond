import useSWR from "swr";

import { isClashX, jsBridge } from "./clashx-bridge";

export function useClashXData() {
  const { data, mutate } = useSWR("/clashx", async () => {
    if (!isClashX())
      return { isClashX: false, startAtLogin: false, systemProxy: false };
    return {
      isClashX: true,
      startAtLogin: (await jsBridge?.getStartAtLogin()) ?? false,
      systemProxy: (await jsBridge?.isSystemProxySet()) ?? false,
    };
  });
  return { data, update: mutate };
}
