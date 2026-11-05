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
import { toast } from "sonner";

import { isClashX, jsBridge } from "@/platform/clashx-bridge";
import { useClient } from "@/state/controller-target";
import { useConfig } from "@/state/user-preferences";

import { useProxy, useProxyProviders } from "./proxy-data";

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
    // 取消的節點回到「未測試」，不留下任何結果；寫入 "untested" 會被
    // 各顯示層當成失敗（狀態值非空且非 ok/testing）。
    setResults((values) =>
      Object.fromEntries(
        Object.entries(values).filter(
          ([, result]) => result.status !== "testing",
        ),
      ),
    );
    setProgress({ running: false, completed: 0, total: 0 });
  };
  const run = async (names: string[]) => {
    if (current.current) return;
    const url = data.testURL || "https://www.gstatic.com/generate_204";
    const timeout = data.testTimeout ?? 5000;
    if (!validLatencyOptions(url, timeout)) {
      toast.error(t("invalid"));
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
            // 無端點（本機 daemon 離線）時測試直接判失敗，不對佔位地址發請求。
            const delay = isClashX()
              ? ((await jsBridge?.getProxyDelay(name)) ?? 0)
              : client
                ? (
                    await client.getProxyDelay(
                      name,
                      url,
                      timeout,
                      controller.signal,
                    )
                  ).data.delay
                : 0;
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
        // 完成後收起進度：完成數停留在畫面上會被誤讀為仍在執行。
        setProgress({ running: false, completed: 0, total: 0 });
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
