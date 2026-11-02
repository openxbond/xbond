// chrome.proxy 设置引擎：enabled=false 或 direct 模式 → 释放本扩展的设置
// （clear，不写显式直连）；rule/global 模式 → inline PAC（mandatory：解析
// 失败即加载失败，绝不半残运行）。所有写入先过凭据守卫；读取回报
// levelOfControl，控制权被策略或他人持有时如实上报。

import type { ExtensionConfig } from "../shared/extension-config.ts";
import {
  assertPacContainsNoCredentials,
  generateGlobalPacSource,
  generatePacSource,
} from "../shared/pac.ts";
import type { Selection } from "../shared/workspace.ts";
import type { RoutingMode } from "./store.ts";

/** 控制通道（订阅源）域名：PAC 模式不支持 bypassList，生成时显式放行，
 * 入口不可达时订阅刷新仍能走直连重试。 */
function hostOf(url: string | null): string[] {
  if (!url) return [];
  try {
    return [new URL(url).host];
  } catch {
    return [];
  }
}

/** 生成期望的 ProxyConfig；direct/off 返回 null（表示 clear）。 */
export function expectedProxyValue(
  config: ExtensionConfig,
  selection: Selection,
  mode: RoutingMode,
  subscriptionUrl: string | null,
): chrome.proxy.ProxyConfig | null {
  if (mode === "direct") return null;
  const bypassHosts = hostOf(subscriptionUrl);
  const pacSource =
    mode === "global"
      ? generateGlobalPacSource(config, selection, bypassHosts)
      : generatePacSource(config, selection, bypassHosts);
  assertPacContainsNoCredentials(pacSource, config);
  return {
    mode: "pac_script",
    pacScript: { data: pacSource, mandatory: true },
  };
}

export function setProxy(value: chrome.proxy.ProxyConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.set({ value, scope: "regular" }, () => {
      const error = chrome.runtime.lastError;
      if (error)
        reject(new Error(error.message ?? "chrome.proxy.settings.set failed"));
      else resolve();
    });
  });
}

/** clear = 释放本扩展的代理设置（回到用户/策略自己的配置），不是显式直连。 */
export function clearProxy(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.clear({ scope: "regular" }, () => {
      const error = chrome.runtime.lastError;
      if (error)
        reject(
          new Error(error.message ?? "chrome.proxy.settings.clear failed"),
        );
      else resolve();
    });
  });
}

export function readProxySetting(): Promise<chrome.proxy.SettingRead | null> {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.get({}, (details) => {
      const error = chrome.runtime.lastError;
      if (error)
        reject(new Error(error.message ?? "chrome.proxy.settings.get failed"));
      else resolve(details ?? null);
    });
  });
}

/** 实际设置与期望值比对（PAC 源码逐字节比较）。 */
export function settingMatches(
  actual: chrome.proxy.SettingRead,
  expected: chrome.proxy.ProxyConfig | null,
): boolean {
  if (expected === null) return true;
  const value = actual.value;
  if (!value || value.mode !== expected.mode) return false;
  return value.pacScript?.data === expected.pacScript?.data;
}
