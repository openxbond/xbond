// 订阅导入与刷新：状态页「一键导入」交付的或用户粘贴的订阅链接就是全部
// 凭据。拉取 target=extension 配置，解析 subscription-userinfo 头得到用量
// 与到期；任何失败都保留上一份有效配置并上报显式状态，绝不静默直连。

import {
  parseExtensionConfig,
  parseUserInfo,
  type ExtensionConfig,
} from "../shared/extension-config.ts";
import {
  loadConfig,
  loadSubscription,
  logEvent,
  saveConfig,
  saveQuota,
  saveSubscription,
  type SubscriptionSource,
} from "./store.ts";

/** 归一订阅地址：强制 target=extension（粘贴的客户端链接也能用）。 */
export function withExtensionTarget(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.searchParams.set("target", "extension");
  return url.toString();
}

export type FetchResult =
  | { ok: true; config: ExtensionConfig; version: string }
  | { ok: false; error: string; retryable: boolean };

/** 拉取订阅配置（不落盘）：HTTP 状态按订阅端点的语义映射到可读错误。 */
export async function fetchConfig(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<FetchResult> {
  let response: Response;
  try {
    response = await fetchFn(withExtensionTarget(url), { cache: "no-store" });
  } catch (error) {
    return { ok: false, error: `network: ${String(error)}`, retryable: true };
  }
  if (response.status === 401)
    return { ok: false, error: "invalid subscription link", retryable: false };
  if (response.status === 403)
    return {
      ok: false,
      error: "subscription unavailable (banned or no plan / quota)",
      retryable: true,
    };
  if (response.status === 503)
    return { ok: false, error: "ingress unavailable", retryable: true };
  if (!response.ok)
    return { ok: false, error: `http ${response.status}`, retryable: true };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "response is not JSON", retryable: false };
  }
  let config: ExtensionConfig;
  try {
    config = parseExtensionConfig(body);
  } catch (error) {
    return {
      ok: false,
      error: `invalid config: ${String(error)}`,
      retryable: false,
    };
  }
  const quota = parseUserInfo(response.headers.get("subscription-userinfo"));
  if (quota) await saveQuota(quota);
  return {
    ok: true,
    config,
    version: response.headers.get("etag") ?? String(Date.now()),
  };
}

/** 导入（用户粘贴或一键导入）：成功才落盘订阅源与配置。 */
export async function importSubscription(url: string): Promise<FetchResult> {
  const result = await fetchConfig(url);
  if (!result.ok) {
    logEvent("error", `subscription import failed: ${result.error}`);
    return result;
  }
  const source: SubscriptionSource = {
    url: withExtensionTarget(url),
    importedAt: Date.now(),
    version: result.version,
  };
  await saveSubscription(source);
  await saveConfig(result.config);
  logEvent(
    "info",
    `subscription imported: ${result.config.nodes.length} nodes`,
  );
  return result;
}

/** 定时/手动刷新：失败时保留上一份有效配置（宁可旧配置继续可用）。 */
export async function refreshSubscription(): Promise<FetchResult | null> {
  const source = await loadSubscription();
  if (!source) return null;
  const result = await fetchConfig(source.url);
  if (!result.ok) {
    logEvent(
      "warn",
      `subscription refresh failed (keeping the last config): ${result.error}`,
    );
    return result;
  }
  const previous = await loadConfig();
  await saveConfig(result.config);
  await saveSubscription({
    ...source,
    importedAt: Date.now(),
    version: result.version,
  });
  if (!previous || previous.nodes.length !== result.config.nodes.length) {
    logEvent(
      "info",
      `subscription refreshed: ${result.config.nodes.length} nodes`,
    );
  }
  return result;
}
