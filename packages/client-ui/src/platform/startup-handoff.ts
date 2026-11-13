import { isTauriAndroid } from "./host.ts";
import { invokeDesktop, invokeTauri } from "./local-api-bootstrap.ts";

/**
 * 启动收尾上报（startup hand-off）：daemon 连接落定后，原生层据此收掉
 * 启动画面——桌面 shell 关闭 splash 窗口并按 reveal 规则揭窗；Android 放开
 * 原生 splash 的 keep-on-screen；iOS 的 LaunchScreen storyboard 由系统在
 * 首帧自动收掉，没有需要上报的对象。
 *
 * 供 app/startup-handoff.ts 的 hook 与测试调用；只用相对导入，保持
 * `node --test` 可直接加载（@/ 别名只有 Vite 解析）。
 */
export function reportStartupSettled(): void {
  // invokeDesktop() 在 Android/web 上为 null，invokeTauri() 在非 Tauri
  // 环境为 null——两类宿主都自然退化为无操作。
  const invoke = isTauriAndroid() ? invokeTauri() : invokeDesktop();
  if (!invoke) return;
  const command = isTauriAndroid()
    ? "plugin:xbond|startup_complete"
    : "startup_complete";
  void invoke(command).catch(() => {});
}
