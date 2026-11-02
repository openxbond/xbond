// 订阅状态页的桥（content script）：在状态页上注入「扩展已安装」标记，并
// 接收页面「一键导入」按钮的 postMessage，把订阅 URL 交给 background 导入。
// 只匹配订阅配置路径；不读取页面内容、不注入任何页面脚本。

import type { ExtensionMessage } from "../background/engine.ts";

// 标记：状态页按钮据此判断走 postMessage 还是复制链接引导安装。
document.documentElement.setAttribute("data-xbond-extension", "installed");

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  const data = event.data as {
    type?: unknown;
    subscriptionUrl?: unknown;
  } | null;
  if (
    !data ||
    data.type !== "XBOND_EXTENSION_IMPORT" ||
    typeof data.subscriptionUrl !== "string"
  ) {
    return;
  }
  const message: ExtensionMessage = {
    type: "import-subscription",
    url: data.subscriptionUrl,
  };
  chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
});
