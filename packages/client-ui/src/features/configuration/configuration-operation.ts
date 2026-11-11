import { atom, useAtomValue, useStore } from "jotai";
import { useCallback } from "react";

type ConfigurationOperation = "use" | "sync";
const operationAtom = atom<ConfigurationOperation | null>(null);

/** One operation spans the detail pane and quick switcher, including recovery. */
export function useConfigurationOperation() {
  const operation = useAtomValue(operationAtom);
  const store = useStore();
  const run = useCallback(
    async <T>(kind: ConfigurationOperation, work: () => Promise<T>) => {
      if (store.get(operationAtom))
        throw new Error("A configuration operation is already in progress.");
      store.set(operationAtom, kind);
      try {
        return await work();
      } finally {
        store.set(operationAtom, null);
      }
    },
    [store],
  );
  return { operation, run };
}
