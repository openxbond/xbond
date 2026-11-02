// 账户编排：RFC 8628 设备流的登录/轮询/刷新与 extension-config 拉取。凭据
// 分层（store.ts）：access token 是会话秘密，refresh token 持久化；登录进行
// 态是会话作用域——浏览器重启即放弃登录。配置拉取失败按可重试/不可重试分流
// 记入诊断环，绝不吞错。

import { ApiClient, DeviceFlowError } from "../shared/api.ts";
import type { ProxyState } from "../shared/types.ts";
import {
  clearPendingLogin,
  clearTokens,
  loadPendingLogin,
  loadTokens,
  logEvent,
  saveConfig,
  saveEntitlement,
  savePendingLogin,
  saveTokens,
  type PendingLogin,
  type StoredTokens,
} from "./store.ts";

/** OAuth 客户端注册（Cloud db/defaults/oauth-clients.ts 的 DEVICE_CODE_GRANT）。 */
const CLIENT_ID = "xbond-app";

export function createAccount(origin: string) {
  const api = new ApiClient(origin);

  /** 发起设备流登录：开验证页（verification_uri_complete 优先）。 */
  async function startLogin(
    openTab: (url: string) => void,
  ): Promise<ProxyState> {
    try {
      const start = await api.startDeviceFlow(CLIENT_ID);
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
      return {
        kind: "pending-login",
        userCode: pending.userCode,
        verificationUri: pending.verificationUri,
        verificationUriComplete: pending.verificationUriComplete,
        expiresAt: pending.expiresAt,
      };
    } catch (error) {
      logEvent("error", `device login failed to start: ${String(error)}`);
      return { kind: "error", detail: String(error) };
    }
  }

  /**
   * 轮询一次令牌端点。返回：
   *   - { kind: "pending" } → 仍在等待授权（调用方按 interval 续排）；
   *   - { kind: "done", state } → 登录终态（成功内含配置拉取，或失败）。
   */
  async function pollOnce(): Promise<
    { kind: "pending" } | { kind: "done"; state: ProxyState }
  > {
    const pending = await loadPendingLogin();
    if (!pending) return { kind: "done", state: { kind: "signed-out" } };
    if (Date.now() > pending.expiresAt) {
      await clearPendingLogin();
      logEvent("warn", "device login expired");
      return { kind: "done", state: { kind: "signed-out" } };
    }
    const result = await api.pollDeviceFlow(CLIENT_ID, pending.deviceCode);
    if (result instanceof DeviceFlowError) {
      if (result.retryable) return { kind: "pending" };
      await clearPendingLogin();
      logEvent("error", `device login failed: ${result.code}`);
      return { kind: "done", state: { kind: "signed-out" } };
    }
    await clearPendingLogin();
    await saveTokens(result);
    logEvent("info", "device login approved");
    await refreshConfig(result);
    return {
      kind: "done",
      state: { kind: "ok", mode: "global", label: "", issuanceVersion: "" },
    };
  }

  /**
   * 拉取 extension-config 并落盘；access token 失效时刷新一次（轮换语义）
   * 再试。刷新失败清凭据回 signed-out。
   */
  async function refreshConfig(freshTokens?: StoredTokens): Promise<void> {
    let tokens = freshTokens ?? (await loadTokens());
    if (!tokens) {
      logEvent("warn", "config refresh skipped: signed out");
      return;
    }
    try {
      await fetchAndApply(tokens.accessToken);
    } catch (first) {
      if (
        !(first instanceof DeviceFlowError) ||
        first.code !== "config_http_401"
      ) {
        logEvent("error", `config fetch failed: ${String(first)}`);
        return;
      }
      try {
        tokens = await api.refreshTokens(CLIENT_ID, tokens.refreshToken);
        await saveTokens(tokens);
        await fetchAndApply(tokens.accessToken);
      } catch (refreshError) {
        if (
          refreshError instanceof DeviceFlowError &&
          refreshError.code === "config_http_401"
        ) {
          logEvent("error", "refresh rejected; credentials cleared");
          await clearTokens();
          return;
        }
        logEvent(
          "error",
          `config fetch failed after refresh: ${String(refreshError)}`,
        );
      }
    }
  }

  async function fetchAndApply(accessToken: string): Promise<void> {
    const { config, entitlement } = await api.fetchExtensionConfig(accessToken);
    await saveConfig(config);
    if (entitlement) await saveEntitlement(entitlement);
    logEvent("info", `extension config applied (v ${config.issuanceVersion})`);
  }

  async function cancelLogin(): Promise<void> {
    await clearPendingLogin();
    logEvent("info", "device login cancelled");
  }

  /** 登出：清凭据；代理偏好保留（重新登录后一键恢复）。 */
  async function logout(): Promise<void> {
    await clearTokens();
    await clearPendingLogin();
    logEvent("info", "signed out");
  }

  return { startLogin, pollOnce, cancelLogin, refreshConfig, logout };
}
