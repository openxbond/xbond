// 账户编排：扩展只接受 XBond 账号（RFC 8628 设备流登录），没有第三方订阅
// 可导入——登录即确定用户，随后以 Bearer 通道拉取 target=extension 配置。
// access token 过期时刷新一次（轮换语义）；刷新被拒即清凭据回未登录态。

import { ApiClient, ApiError } from "../shared/api.ts";
import type { ExtensionConfig } from "../shared/extension-config.ts";
import {
  clearLoginEnded,
  clearPendingLogin,
  clearTokens,
  loadPendingLogin,
  loadTokens,
  logEvent,
  saveConfig,
  saveConfigError,
  saveLoginEnded,
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
      await saveLoginEnded("expired");
      logEvent("warn", "device login expired");
      return "expired";
    }
    let result: Awaited<ReturnType<typeof api.pollDeviceFlow>>;
    try {
      result = await api.pollDeviceFlow(pending.deviceCode);
    } catch {
      logEvent("warn", "device login polling interrupted; retrying");
      return "pending";
    }
    if (result instanceof ApiError) {
      if (result.retryable) return "pending";
      await clearPendingLogin();
      await saveLoginEnded("failed");
      logEvent("error", `device login failed: ${result.code}`);
      return "failed";
    }
    await clearPendingLogin();
    await clearLoginEnded();
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
    const apply = async (active: StoredTokens): Promise<ExtensionConfig> => {
      const { config, quota } = await api.fetchConfig(active.accessToken);
      await saveConfig(config);
      await saveQuota(quota);
      return config;
    };
    try {
      if (!tokens.accessToken || tokens.accessTokenExpiresAt <= Date.now()) {
        tokens = await api.refreshTokens(tokens.refreshToken);
        await saveTokens(tokens);
      }
      const config = await apply(tokens);
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
        await saveConfigError(String(error));
        if (
          error instanceof ApiError &&
          ["invalid_grant", "invalid_token"].includes(error.code)
        )
          await clearTokens();
        logEvent("error", `config fetch failed: ${String(error)}`);
        return null;
      }
      try {
        tokens = await api.refreshTokens(tokens.refreshToken);
        await saveTokens(tokens);
        const config = await apply(tokens);
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
        await saveConfigError(String(refreshError));
        if (
          refreshError instanceof ApiError &&
          ["invalid_grant", "invalid_token", "http_401"].includes(
            refreshError.code,
          )
        )
          await clearTokens();
        return null;
      }
    }
  }

  async function cancelLogin(): Promise<void> {
    await clearPendingLogin();
    await clearLoginEnded();
    logEvent("info", "device login cancelled");
  }

  /** 登出：清凭据（配置保留；代理由引擎在下次收敛时释放）。 */
  async function logout(): Promise<void> {
    await clearTokens();
    await clearPendingLogin();
    await clearLoginEnded();
    logEvent("info", "signed out");
  }

  return { startLogin, pollOnce, refreshConfig, cancelLogin, logout };
}
