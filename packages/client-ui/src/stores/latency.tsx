import { error } from "@components/Message";
import { isClashX, jsBridge } from "@lib/jsBridge";
import {
  validLatencyOptions,
  runLatencyTests,
  type LatencyResult,
} from "@xbond/client/latency";
import { isAxiosError } from "axios";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { useConfig, useProxy, useProxyProviders } from "./jotai";
import { useClient } from "./request";

function useLatencyRunner() {
  const client = useClient();
  const { data } = useConfig();
  const { t } = useTranslation("proxies");
  const { update } = useProxy();
  const { update: updateProviders } = useProxyProviders();
  const [results, setResults] = useState<Record<string, LatencyResult>>({});
  const [progress, setProgress] = useState({
    running: false,
    completed: 0,
    total: 0,
  });
  const current = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      current.current?.abort();
    },
    [],
  );
  const cancel = () => {
    current.current?.abort();
    current.current = null;
    setResults((values) =>
      Object.fromEntries(
        Object.entries(values).map(([name, result]) => [
          name,
          result.status === "testing" ? { status: "untested" } : result,
        ]),
      ),
    );
    setProgress((p) => ({ ...p, running: false }));
  };
  const run = async (names: string[]) => {
    if (current.current) return;
    const url = data.testURL || "https://www.gstatic.com/generate_204";
    const timeout = data.testTimeout ?? 5000;
    if (!validLatencyOptions(url, timeout)) {
      error(t("invalid"));
      return;
    }
    const controller = new AbortController();
    current.current = controller;
    const unique = [...new Set(names)];
    setProgress({ running: true, completed: 0, total: unique.length });
    try {
      await runLatencyTests(
        unique,
        async (name) => {
          setResults((values) => ({
            ...values,
            [name]: { status: "testing" },
          }));
          let result: LatencyResult;
          try {
            const delay = isClashX()
              ? ((await jsBridge?.getProxyDelay(name)) ?? 0)
              : (
                  await client.getProxyDelay(
                    name,
                    url,
                    timeout,
                    controller.signal,
                  )
                ).data.delay;
            result = delay > 0 ? { status: "ok", delay } : { status: "failed" };
          } catch (err) {
            result = {
              status:
                isAxiosError(err) &&
                (err.response?.status === 504 ||
                  ["ECONNABORTED", "ETIMEDOUT"].includes(err.code ?? ""))
                  ? "timedOut"
                  : "failed",
            };
          }
          if (controller.signal.aborted) return;
          setResults((values) => ({ ...values, [name]: result }));
          setProgress((p) => ({ ...p, completed: p.completed + 1 }));
        },
        controller.signal,
      );
      if (!controller.signal.aborted)
        await Promise.all([update(), updateProviders()]);
    } catch {
      /* Per-node results remain available if refreshing the core fails. */
    } finally {
      if (current.current === controller) {
        current.current = null;
        setProgress((p) => ({ ...p, running: false }));
      }
    }
  };
  const invalidate = (names: string[]) => {
    setResults((values) =>
      Object.fromEntries(
        Object.entries(values).filter(([name]) => !names.includes(name)),
      ),
    );
  };
  return { results, progress, run, cancel, invalidate };
}
const LatencyContext = createContext<ReturnType<
  typeof useLatencyRunner
> | null>(null);
export function LatencyProvider({ children }: { children: ReactNode }) {
  const value = useLatencyRunner();
  return <LatencyContext value={value}>{children}</LatencyContext>;
}
export function useLatency() {
  const value = useContext(LatencyContext);
  if (!value) throw new Error("Missing LatencyProvider");
  return value;
}
