// MV3 service worker 入口：装配监听并立即收敛一次。SW 休眠后任何事件唤醒
// 都重新执行本文件——installListeners 的 addListener 是幂等的，reconcile 以
// storage 为事实源，重复执行无害。

import { installListeners, reconcile } from "./engine.ts";
import { logEvent } from "./store.ts";

installListeners();
void reconcile("worker wake").catch((error) => {
  logEvent("error", `reconcile failed: ${String(error)}`);
});
