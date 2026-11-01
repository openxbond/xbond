// chrome.proxy 设置引擎：global = fixed_servers，rules = inline PAC。所有写入
// 都先过凭据守卫（PAC 永不携带凭据），所有读取都回报 levelOfControl——控制权
// 被策略或其他扩展抢走是显式状态（control-lost），不是静默失败。

import {
  generatePacSource,
  assertPacContainsNoCredential,
} from "../shared/pac.ts";
import type { ExtensionConfig, ProxyMode } from "../shared/types.ts";

/** 控制通道 bypass：扩展自己的 API 请求必须不经代理，否则入口不可达时连
 * 重试/状态上报都会一起死掉。API origin 由构建期注入。 */
declare const __XBOND_API_ORIGIN__: string;

function bypassList(): string[] {
  try {
    const origin = new URL(__XBOND_API_ORIGIN__);
    return [origin.host];
  } catch {
    return [];
  }
}

/** global 模式的 fixed_servers 规则。 */
export function fixedServersValue(
  config: ExtensionConfig,
): chrome.proxy.ProxyConfig {
  return {
    mode: "fixed_servers",
    rules: {
      singleProxy: {
        scheme: "https",
        host: config.ingress.hosts[0] ?? "",
        port: config.ingress.port,
      },
      bypassList: bypassList(),
    },
  };
}

/** rules 模式的 PAC 脚本规则（inline data，mandatory：解析失败即加载失败）。 */
export function pacScriptValue(
  config: ExtensionConfig,
): chrome.proxy.ProxyConfig {
  const source = generatePacSource(config, "rules");
  assertPacContainsNoCredential(source, config.auth.credential);
  return {
    mode: "pac_script",
    pacScript: { data: source, mandatory: true },
  };
}

export function expectedProxyValue(
  config: ExtensionConfig,
  mode: ProxyMode,
): chrome.proxy.ProxyConfig {
  return mode === "rules" ? pacScriptValue(config) : fixedServersValue(config);
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

/** 结构比较实际设置与期望值（ PAC 源码逐字节比较，入口 host:port 比较）。 */
export function settingMatches(
  actual: chrome.proxy.SettingRead,
  expected: chrome.proxy.ProxyConfig,
): boolean {
  const value = actual.value;
  if (!value || value.mode !== expected.mode) return false;
  if (value.mode === "pac_script") {
    return value.pacScript?.data === expected.pacScript?.data;
  }
  if (value.mode === "fixed_servers") {
    const a = value.rules?.singleProxy;
    const b = expected.rules?.singleProxy;
    return Boolean(
      a && b && a.scheme === b.scheme && a.host === b.host && a.port === b.port,
    );
  }
  return false;
}
