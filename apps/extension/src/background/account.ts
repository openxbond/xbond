// 账户编排：扩展只接受 XBond 账号（RFC 8628 设备流登录），没有第三方订阅
// 可导入——登录即确定用户，随后以 Bearer 通道拉取 target=extension 配置。
// access token 过期时刷新一次（轮换语义）；刷新被拒即清凭据回未登录态。

import { ApiClient, ApiError } from "../shared/api.ts";
import type { ExtensionConfig } from "../shared/extension-config.ts";
import {
  clearPendingLogin,
  clearTokens,
  loadPendingLogin,
  loadTokens,
  logEvent,
  saveConfig,
  savePendingLogin,
  saveQuota,
  saveTokens,
  type PendingLogin,
  type StoredTokens,
} from "./store.ts";

export function createAccount(origin: string) {
  const api = new ApiClient(origin);

  /** 发起设备流登录：开验证页（verification_uri_complete 优先）。 */
  async function startLogin(
    openTab: (url: string) => void,
  ): Promise<
    | { kind: "pending"; pending: PendingLogin }
    | { kind: "error"; detail: string }
  > {
    try {
      const start = await api.startDeviceFlow();
      const pending: PendingLogin = {
        deviceCode: start.deviceCode,
        userCode: start.userCode,
        verificationUri: start.verificationUri,
        verificationUriComplete: start.verificationUriComplete,
        expiresAt: Date.now() + start.expiresInSeconds * 1000,
        intervalSeconds: start.intervalSeconds,
      };
      await savePendingLogin(pending);
      openTab(pending.verificationUriComplete ?? pending.verificationUri);
      logEvent("info", "device login started");
      return { kind: "pending", pending };
    } catch (error) {
      logEvent("error", `device login failed to start: ${String(error)}`);
      return { kind: "error", detail: String(error) };
    }
  }

  /** 轮询一次令牌端点：pending 时返回 null；成功即存凭据并拉取配置。 */
  async function pollOnce(): Promise<
    "pending" | "approved" | "failed" | "expired"
  > {
    const pending = await loadPendingLogin();
    if (!pending) return "failed";
    if (Date.now() > pending.expiresAt) {
      await clearPendingLogin();
      logEvent("warn", "device login expired");
      return "expired";
    }
    const result = await api.pollDeviceFlow(pending.deviceCode);
    if (result instanceof ApiError) {
      if (result.retryable) return "pending";
      await clearPendingLogin();
      logEvent("error", `device login failed: ${result.code}`);
      return "failed";
    }
    await clearPendingLogin();
    await saveTokens(result);
    logEvent("info", "device login approved");
    await refreshConfig(result);
    return "approved";
  }

  /** 拉取配置并落盘；access token 失效时刷新一次再试，刷新被拒清凭据。 */
  async function refreshConfig(
    freshTokens?: StoredTokens,
  ): Promise<ExtensionConfig | null> {
    let tokens = freshTokens ?? (await loadTokens());
    if (!tokens) return null;
    try {
      const { config, quota } = await api.fetchConfig(tokens.accessToken);
      await saveConfig(config);
      if (quota) await saveQuota(quota);
      logEvent(
        "info",
        `extension config applied (${config.nodes.length} nodes)`,
      );
      return config;
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.code !== "config_unauthorized"
      ) {
        logEvent("error", `config fetch failed: ${String(error)}`);
        return null;
      }
      try {
        tokens = await api.refreshTokens(tokens.refreshToken);
        await saveTokens(tokens);
        const { config, quota } = await api.fetchConfig(tokens.accessToken);
        await saveConfig(config);
        if (quota) await saveQuota(quota);
        logEvent(
          "info",
          `extension config applied after refresh (${config.nodes.length} nodes)`,
        );
        return config;
      } catch (refreshError) {
        logEvent(
          "error",
          `token refresh failed; signing out: ${String(refreshError)}`,
        );
        await clearTokens();
        return null;
      }
    }
  }

  async function cancelLogin(): Promise<void> {
    await clearPendingLogin();
    logEvent("info", "device login cancelled");
  }

  /** 登出：清凭据（配置保留；代理由引擎在下次收敛时释放）。 */
  async function logout(): Promise<void> {
    await clearTokens();
    await clearPendingLogin();
    logEvent("info", "signed out");
  }

  return { startLogin, pollOnce, refreshConfig, cancelLogin, logout };
}
