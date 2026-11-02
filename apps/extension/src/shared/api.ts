// XBond API 客户端（纯 fetch，可注入）：RFC 8628 设备流登录与
// target=extension 配置拉取（订阅端点的 Bearer 通道）。扩展只接受 XBond
// 账号——没有第三方订阅可导入，登录即确定用户与全部凭据。

import {
  parseExtensionConfig,
  type ExtensionConfig,
  type Quota,
  parseUserInfo,
} from "./extension-config.ts";

/** OAuth 客户端注册（Cloud db/defaults/oauth-clients.ts 的 DEVICE_CODE_GRANT）。 */
export const CLIENT_ID = "xbond-app";
export const SUBSCRIPTION_RESOURCE = "urn:xbond:api:subscription";

const DEFAULT_POLL_INTERVAL_S = 5;

export type DeviceCodeStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresInSeconds: number;
  intervalSeconds: number;
};

export type DeviceTokens = {
  accessToken: string;
  refreshToken: string;
  /** access token 绝对过期时刻（epoch ms）。 */
  accessTokenExpiresAt: number;
};

export class ApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable: boolean) {
    super(`api: ${code}`);
    this.code = code;
    this.retryable = retryable;
  }
}

export type ConfigResult = {
  config: ExtensionConfig;
  quota: Quota | null;
};

export class ApiClient {
  private readonly origin: string;
  private readonly fetchFn: typeof fetch;

  constructor(origin: string, fetchFn?: typeof fetch) {
    this.origin = origin.replace(/\/$/, "");
    // fetch 必须绑定到全局作用域再调用：直接把全局 fetch 存成实例属性会在
    // Service Worker 里触发 "Illegal invocation"（this 不再指向 WorkerGlobalScope）。
    this.fetchFn = fetchFn ?? ((input, init) => fetch(input, init));
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

  /** RFC 8628 §3.1：发起设备授权。 */
  async startDeviceFlow(): Promise<DeviceCodeStart> {
    const res = await this.postForm("/api/auth/device/code", {
      client_id: CLIENT_ID,
      scope: "api offline_access",
      resource: SUBSCRIPTION_RESOURCE,
    });
    if (!res.ok) throw new ApiError(`start_failed_${res.status}`, false);
    const body = (await res.json()) as Record<string, unknown>;
    const deviceCode = body.device_code;
    const userCode = body.user_code;
    const verificationUri = body.verification_uri;
    if (
      typeof deviceCode !== "string" ||
      typeof userCode !== "string" ||
      typeof verificationUri !== "string"
    ) {
      throw new ApiError("start_payload_invalid", false);
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

  /** RFC 8628 §3.4/§3.5：轮询令牌端点一次。 */
  async pollDeviceFlow(deviceCode: string): Promise<DeviceTokens | ApiError> {
    const res = await this.postForm("/api/auth/oauth2/token", {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: CLIENT_ID,
      resource: SUBSCRIPTION_RESOURCE,
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
    return new ApiError(
      error,
      error === "authorization_pending" || error === "slow_down",
    );
  }

  /** 刷新令牌（轮换语义：新 refresh 替换旧的，调用方负责落盘）。 */
  async refreshTokens(refreshToken: string): Promise<DeviceTokens> {
    const res = await this.postForm("/api/auth/oauth2/token", {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      resource: SUBSCRIPTION_RESOURCE,
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
      throw new ApiError(
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

  /** 拉取 target=extension 配置（Bearer 通道）并解析用量头。 */
  async fetchConfig(accessToken: string): Promise<ConfigResult> {
    const url = `${this.origin}/api/subscription/config?target=extension`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
    } catch (error) {
      throw new ApiError(`network: ${String(error)}`, true);
    }
    if (res.status === 401) throw new ApiError("config_unauthorized", false);
    if (res.status === 403) throw new ApiError("config_forbidden", true);
    if (res.status === 503) throw new ApiError("ingress_unavailable", true);
    if (!res.ok) throw new ApiError(`config_http_${res.status}`, true);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ApiError("config_not_json", false);
    }
    return {
      config: parseExtensionConfig(body),
      quota: parseUserInfo(res.headers.get("subscription-userinfo")),
    };
  }
}
