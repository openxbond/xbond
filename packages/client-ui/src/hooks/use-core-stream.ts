import { streamURL } from "@xbond/client/controller";
import type * as API from "@xbond/client/request";
import { StreamReader, type StreamState } from "@xbond/client/streamer";
import { useEffect, useMemo, useState } from "react";

import { useAPIInfo } from "@/state/controller-target";

export function useStreamReader<T>(path: string | null, bufferLength = 0) {
  const {
    endpoint: { url, secret },
  } = useAPIInfo();
  const connection = useMemo(
    () => ({
      stream: new StreamReader<T>({ bufferLength }),
      // 無端點（本機 daemon 離線）時不連接，也不對佔位地址重試。
      endpoint: path && url ? streamURL(url, path, secret) : null,
    }),
    [url, secret, path, bufferLength],
  );
  const { stream, endpoint } = connection;
  useEffect(() => {
    if (endpoint) stream.connect(endpoint);
    return () => stream.disconnect();
  }, [stream, endpoint]);
  return stream;
}
export function useStreamState<T>(stream: StreamReader<T>) {
  const [state, setState] = useState<StreamState>("connecting");
  useEffect(() => stream.subscribeState(setState), [stream]);
  return state;
}
export function useConnectionStreamReader() {
  return useStreamReader<API.Snapshot>("connections");
}
