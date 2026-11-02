// 代理认证（webRequest onAuthRequired）：PAC 把每个出口渲染成
// {password.slice(0,12)}.{server}，质询的 challenger 主机就是它——由此反查
// 节点，回填 Basic(username=proxyToken, password=节点密码)。有界重试：同一
// 回复 30 秒内最多应答 3 次，超限停答并上报 auth-failed，把失败交回浏览器。

import type { ExtensionConfig } from "../shared/extension-config.ts";

// 上界按「同一入口 30 秒窗口」计：一次页面加载会并发多条 CONNECT、每条首次
// 都经历 407，3 次就会把正常导航误判成重试风暴；16 次足以拦住错误凭据的
// 无限循环（Chromium 对同一请求自身的认证重试另有上限），又不误伤正常流量。
const AUTH_RETRY_LIMIT = 16;
const AUTH_WINDOW_MS = 30_000;

export type AuthGate = {
  challenges: Map<string, number[]>;
  exhausted: boolean;
};

export function createAuthGate(): AuthGate {
  return { challenges: new Map(), exhausted: false };
}

export function resetAuthGate(gate: AuthGate): void {
  gate.challenges.clear();
  gate.exhausted = false;
}

/** 从 challenger 主机反查节点：前缀子域优先，裸 server 兼容。 */
export function nodeForChallenger(
  config: ExtensionConfig,
  challengerHost: string,
): { proxyToken: string; password: string } | null {
  const host = challengerHost.toLowerCase();
  const prefixed = config.nodes.find(
    (node) =>
      host === `${node.password.slice(0, 12)}.${node.server}`.toLowerCase(),
  );
  const bare =
    prefixed ?? config.nodes.find((node) => host === node.server.toLowerCase());
  if (!bare) return null;
  return { proxyToken: config.proxyToken, password: bare.password };
}

export function createAuthHandler(
  gate: AuthGate,
  configProvider: () => Promise<ExtensionConfig | null>,
  notify: (level: "warn" | "error", message: string) => void,
) {
  async function answer(
    details: chrome.webRequest.AuthRequiredDetails,
  ): Promise<chrome.webRequest.AuthChallengeResponse | undefined> {
    if (!details.isProxy) return undefined;
    const config = await configProvider();
    if (!config) return undefined;
    const credentials = nodeForChallenger(config, details.challenger.host);
    if (!credentials) return undefined;
    if (gate.exhausted) return undefined;

    const key = `${details.challenger.host.toLowerCase()}:${details.challenger.port}`;
    const now = Date.now();
    const recent = (gate.challenges.get(key) ?? []).filter(
      (time) => now - time < AUTH_WINDOW_MS,
    );
    if (recent.length >= AUTH_RETRY_LIMIT) {
      gate.exhausted = true;
      notify(
        "error",
        `proxy auth failed after ${AUTH_RETRY_LIMIT} challenges for ${key}`,
      );
      return undefined;
    }
    recent.push(now);
    gate.challenges.set(key, recent);
    return {
      authCredentials: {
        username: credentials.proxyToken,
        password: credentials.password,
      },
    };
  }

  // MV3 的 asyncBlocking 只认回调形式（details, callback）：返回 Promise 的
  // 写法不会被调度为认证应答（实测 Edge 156 从不触发）。
  return (
    details: chrome.webRequest.AuthRequiredDetails,
    callback: (response?: chrome.webRequest.AuthChallengeResponse) => void,
  ): void => {
    void answer(details).then((response) => callback(response));
  };
}
