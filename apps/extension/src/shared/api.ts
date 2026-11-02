// Cloud API 客户端（纯 fetch，可注入 fetch 供单测）：RFC 8628 device flow
// 与 extension-config 拉取。选择设备流而非 chrome.identity.launchWebAuthFlow：
// 后者要求把 chrome-extension 重定向 URI 预先登记到 OAuth 客户端（unpacked
// 的扩展 ID 逐机不同，商店发布前无法稳定登记），设备流零集成且与移动端体验
// 一致。凭据分层：access token 属会话秘密（调用方放 storage.session），
// refresh token 由调用方持久化。

import { parseExtensionConfig } from "./config.ts";
import type { EntitlementInfo, ExtensionConfig } from "./types.ts";

/** 设备流轮询节奏：按规范应答 interval，缺省 5s；slow_down 递增 5s。 */
const DEFAULT_POLL_INTERVAL_S = 5;

export type DeviceCodeStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** verification_uri_complete：带预填参数的直达链接（打开即免输入）。 */
  verificationUriComplete: string | null;
  expiresInSeconds: number;
  intervalSeconds: number;
};

export type DeviceTokens = {
  accessToken: string;
  refreshToken: string;
  /** access token 的绝对过期时刻（epoch ms）。 */
  accessTokenExpiresAt: number;
};

export class DeviceFlowError extends Error {
  /** pending / slow_down / expired_token / access_denied / 其他。 */
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable: boolean) {
    super(`device flow: ${code}`);
    this.code = code;
    this.retryable = retryable;
  }
}

export class ApiClient {
  private readonly origin: string;
  private readonly fetchFn: typeof fetch;

  constructor(origin: string, fetchFn: typeof fetch = fetch) {
    this.origin = origin;
    this.fetchFn = fetchFn;
  }

  private async postForm(
    path: string,
    body: Record<string, string>,
  ): Promise<Response> {
    return this.fetchFn(`${this.origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  }

  /** RFC 8628 §3.1：发起设备授权（Cloud 为 better-auth 的 device 端点）。 */
  async startDeviceFlow(clientId: string): Promise<DeviceCodeStart> {
    const res = await this.postForm("/api/auth/device/code", {
      client_id: clientId,
      scope: "api offline_access",
      resource: "urn:xbond:api:subscription",
    });
    if (!res.ok) throw new DeviceFlowError(`start_failed_${res.status}`, false);
    const body = (await res.json()) as Record<string, unknown>;
    const deviceCode = body.device_code;
    const userCode = body.user_code;
    const verificationUri = body.verification_uri;
    if (
      typeof deviceCode !== "string" ||
      typeof userCode !== "string" ||
      typeof verificationUri !== "string"
    ) {
      throw new DeviceFlowError("start_payload_invalid", false);
    }
    const complete = body.verification_uri_complete;
    return {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete: typeof complete === "string" ? complete : null,
      expiresInSeconds:
        typeof body.expires_in === "number" ? body.expires_in : 600,
      intervalSeconds:
        typeof body.interval === "number"
          ? body.interval
          : DEFAULT_POLL_INTERVAL_S,
    };
  }

  /** RFC 8628 §3.4/§3.5：轮询令牌端点一次，映射五种规范错误。 */
  async pollDeviceFlow(
    clientId: string,
    deviceCode: string,
  ): Promise<DeviceTokens | DeviceFlowError> {
    const res = await this.postForm("/api/auth/oauth2/token", {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: clientId,
      resource: "urn:xbond:api:subscription",
    });
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (
      res.ok &&
      typeof body.access_token === "string" &&
      typeof body.refresh_token === "string"
    ) {
      const expiresIn =
        typeof body.expires_in === "number" ? body.expires_in : 3600;
      return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        accessTokenExpiresAt: Date.now() + expiresIn * 1000,
      };
    }
    const error =
      typeof body.error === "string" ? body.error : `http_${res.status}`;
    const retryable =
      error === "authorization_pending" || error === "slow_down";
    return new DeviceFlowError(error, retryable);
  }

  /** 刷新令牌：轮换语义（新 refresh 替换旧的，调用方负责落盘）。 */
  async refreshTokens(
    clientId: string,
    refreshToken: string,
  ): Promise<DeviceTokens> {
    const res = await this.postForm("/api/auth/oauth2/token", {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      resource: "urn:xbond:api:subscription",
    });
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (
      !res.ok ||
      typeof body.access_token !== "string" ||
      typeof body.refresh_token !== "string"
    ) {
      throw new DeviceFlowError(
        typeof body.error === "string" ? body.error : `http_${res.status}`,
        false,
      );
    }
    const expiresIn =
      typeof body.expires_in === "number" ? body.expires_in : 3600;
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      accessTokenExpiresAt: Date.now() + expiresIn * 1000,
    };
  }

  /** 拉取版本化扩展配置：运行配置过 parse 校验，权益摘要随响应透出。 */
  async fetchExtensionConfig(
    accessToken: string,
  ): Promise<{ config: ExtensionConfig; entitlement: EntitlementInfo | null }> {
    const res = await this.fetchFn(
      `${this.origin}/api/subscription/extension-config`,
      {
        headers: { authorization: `Bearer ${accessToken}` },
      },
    );
    if (res.status === 503)
      throw new DeviceFlowError("ingress_unavailable", true);
    if (!res.ok) throw new DeviceFlowError(`config_http_${res.status}`, false);
    const body = (await res.json()) as Record<string, unknown>;
    const config = parseExtensionConfig(body);
    const raw = body.entitlement;
    let entitlement: EntitlementInfo | null = null;
    if (typeof raw === "object" && raw !== null) {
      const record = raw as Record<string, unknown>;
      if (
        typeof record.dataUsedBytes === "number" &&
        typeof record.dataLimitBytes === "number" &&
        typeof record.servicePeriodEnd === "string"
      ) {
        entitlement = {
          dataUsedBytes: record.dataUsedBytes,
          dataLimitBytes: record.dataLimitBytes,
          servicePeriodEnd: record.servicePeriodEnd,
        };
      }
    }
    return { config, entitlement };
  }
}
