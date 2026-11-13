import { useCallback, useEffect, useRef } from "react";

import { reportStartupSettled } from "@/platform/startup-handoff";
import { useLocalAPI } from "@/state/local-runtime";

/**
 * 启动收尾（startup hand-off）：耗时的 daemon 解析与首个状态拉取都发生在
 * 启动画面覆盖之下（桌面是隐藏主窗口里的 webview，移动端是原生 splash 之后
 * 的应用内连接动画）。daemon 状态落定（ready 或首个失败判定）时上报一次，
 * 原生层收掉启动画面、按各自的可见性规则揭窗（platform/startup-handoff.ts）。
 */

/** daemon 迟迟不落定（拉起失败、状态迟迟不就绪）时的兜底预算：启动画面
 * 最长挡到这个时间就把主界面交出来，connecting/offline 的事实由应用内
 * 状态照常表达——启动画面不能替用户挡住它们，更不能拖慢可用时间。 */
const STARTUP_HANDOFF_CAP_MS = 3_000;

/** Mount in the app shell: watches the daemon connection and hands the
 * startup off to the native shell exactly once. */
export function useStartupHandoff(): void {
  const { daemonState } = useLocalAPI();
  const reported = useRef(false);
  const report = useCallback(() => {
    if (reported.current) return;
    reported.current = true;
    reportStartupSettled();
  }, []);

  // daemon 状态落定即上报（web 宿主 daemonState 一挂载就非 connecting，
  // 同样无害：无 shell 时上报退化为无操作）。
  useEffect(() => {
    if (daemonState !== "connecting") report();
  }, [daemonState, report]);

  // cap 独立于状态效果计时：daemonState 翻转不重置兜底预算。
  useEffect(() => {
    const timer = setTimeout(report, STARTUP_HANDOFF_CAP_MS);
    return () => clearTimeout(timer);
  }, [report]);
}
