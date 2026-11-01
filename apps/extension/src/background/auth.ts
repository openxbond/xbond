// 代理认证（webRequest onAuthRequired asyncBlocking）：只应答可信质询——
// isProxy 且 challenger 命中配置入口（host + port）；重试有上界，超限停止
// 应答并报告 auth-failed，浏览器会得到失败的请求而不是无限循环。凭据永远
// 不落 PAC、不打日志。

import type { ExtensionConfig } from "../shared/types.ts";

/** 认证重试上界与窗口：同一入口 30 秒内最多应答 3 次质询。 */
const AUTH_RETRY_LIMIT = 3;
const AUTH_WINDOW_MS = 30_000;

type AuthGate = {
  /** SW 生命期内的质询时间戳（按入口键控）；浏览器重启自然清零。 */
  challenges: Map<string, number[]>;
  /** 超限后置位，恢复（配置变更/手动重试）时清除。 */
  exhausted: boolean;
};

export function createAuthGate(): AuthGate {
  return { challenges: new Map(), exhausted: false };
}

function challengerKey(host: string, port: number): string {
  return `${host.toLowerCase()}:${port}`;
}

export function resetAuthGate(gate: AuthGate): void {
  gate.challenges.clear();
  gate.exhausted = false;
}

/**
 * 生成 onAuthRequired 回调。configProvider 每次读取当前配置（storage 为准，
 * SW 休眠唤醒后依然正确）；notify 供引擎上报 auth-failed 状态。
 */
export function createAuthHandler(
  gate: AuthGate,
  configProvider: () => Promise<ExtensionConfig | null>,
  notify: (level: "warn" | "error", message: string) => void,
) {
  return async (
    details: chrome.webRequest.AuthRequiredDetails,
  ): Promise<chrome.webRequest.AuthChallengeResponse | undefined> => {
    // 非代理质询（源站 401 等）不属于我们，绝不代答。
    if (!details.isProxy) return undefined;
    const config = await configProvider();
    if (!config) return undefined;

    const host = details.challenger.host.toLowerCase();
    const matchesIngress =
      config.ingress.hosts.some(
        (candidate) => candidate.toLowerCase() === host,
      ) && details.challenger.port === config.ingress.port;
    if (!matchesIngress) return undefined;

    if (gate.exhausted) {
      // 超限静默拒答：浏览器对该请求失败；状态已上报，不再刷事件环。
      return undefined;
    }

    const key = challengerKey(host, details.challenger.port);
    const now = Date.now();
    const recent = (gate.challenges.get(key) ?? []).filter(
      (time) => now - time < AUTH_WINDOW_MS,
    );
    if (recent.length >= AUTH_RETRY_LIMIT) {
      gate.exhausted = true;
      notify(
        "error",
        `proxy auth failed after ${AUTH_RETRY_LIMIT} challenges; requests will fail until the config is fixed`,
      );
      return undefined;
    }
    recent.push(now);
    gate.challenges.set(key, recent);
    return {
      authCredentials: {
        username: config.auth.username,
        password: config.auth.credential,
      },
    };
  };
}
