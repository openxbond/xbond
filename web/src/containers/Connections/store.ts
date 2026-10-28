import { ConnectionStore } from "@lib/connection-store";
import type { Connection } from "@lib/connection-store";
import type { Connections } from "@lib/request";
import { useState, useMemo, useCallback } from "react";
export type { Connection } from "@lib/connection-store";

export interface FormatConnection {
  id: string;
  host: string;
  chains: string;
  rule: string;
  time: number;
  upload: number;
  download: number;
  type: string;
  network: string;
  process?: string;
  sourceIP: string;
  speed: {
    upload: number;
    download: number;
  };
  completed: boolean;
  original: Connection;
}

export function useConnections() {
  const store = useMemo(() => new ConnectionStore(), []);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [save, setSave] = useState(false);
  const feed = useCallback(
    (connections: Connections[] | null) => {
      store.appendToSet(connections);
      setConnections(store.getConnections());
    },
    [store],
  );
  const toggleSave = useCallback(() => {
    setSave(store.toggleSave());
    setConnections(store.getConnections());
  }, [store]);
  const clearClosed = useCallback(() => {
    store.clearClosed();
    setConnections(store.getConnections());
  }, [store]);
  const resetRate = useCallback(() => store.resetRate(), [store]);
  return { connections, feed, toggleSave, save, clearClosed, resetRate };
}
