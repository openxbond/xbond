// 代理认证（webRequest onAuthRequired）：PAC 把每个出口渲染成
// {password.slice(0,12)}.{server}，质询的 challenger 主机就是它——由此反查
// 节点，回填 Basic(username=proxyToken, password=节点密码)。有界重试：同一
// 回复 30 秒内最多应答 3 次，超限停答并上报 auth-failed，把失败交回浏览器。

import type { ExtensionConfig } from "../shared/extension-config.ts";

const AUTH_RETRY_LIMIT = 3;
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
  return async (
    details: chrome.webRequest.AuthRequiredDetails,
  ): Promise<chrome.webRequest.AuthChallengeResponse | undefined> => {
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
  };
}
