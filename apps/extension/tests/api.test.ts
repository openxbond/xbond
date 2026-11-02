import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiClient, DeviceFlowError } from "../src/shared/api.ts";

/** 可编程 fetch：按 (path, body) 匹配应答，记录请求供断言。 */
function scriptedFetch(
  routes: Array<{
    match: (path: string, body: Record<string, string>) => boolean;
    respond: (body: Record<string, string>) => {
      status: number;
      json: unknown;
    };
  }>,
) {
  const requests: Array<{ path: string; body: Record<string, string> }> = [];
  const fetchFn = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    const path = url.replace(/^https:\/\/api\.example\.com/, "");
    const body: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(String(init?.body ?? ""))) {
      body[key] = value;
    }
    requests.push({ path, body });
    const route = routes.find((r) => r.match(path, body));
    if (!route) throw new Error(`no route for ${path}`);
    const response = route.respond(body);
    return new Response(JSON.stringify(response.json), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchFn, requests };
}

const CLIENT = "xbond-app";

test("device flow start posts scope and resource, surfaces verification data", async () => {
  const { fetchFn, requests } = scriptedFetch([
    {
      match: (path) => path === "/api/auth/device/code",
      respond: () => ({
        status: 200,
        json: {
          device_code: "dc-1",
          user_code: "ABCD-EFGH",
          verification_uri: "https://www.xbond.net/dash/device",
          verification_uri_complete:
            "https://www.xbond.net/dash/device?code=ABCD-EFGH",
          expires_in: 600,
          interval: 3,
        },
      }),
    },
  ]);
  const api = new ApiClient("https://api.example.com", fetchFn);
  const start = await api.startDeviceFlow(CLIENT);
  assert.equal(start.deviceCode, "dc-1");
  assert.equal(start.userCode, "ABCD-EFGH");
  assert.equal(
    start.verificationUriComplete,
    "https://www.xbond.net/dash/device?code=ABCD-EFGH",
  );
  assert.equal(start.intervalSeconds, 3);
  assert.equal(requests[0]?.body.scope, "api offline_access");
  assert.equal(requests[0]?.body.resource, "urn:xbond:api:subscription");
});

test("poll maps authorization_pending to a retryable pending result", async () => {
  const { fetchFn } = scriptedFetch([
    {
      match: (path) => path === "/api/auth/oauth2/token",
      respond: () => ({
        status: 400,
        json: { error: "authorization_pending" },
      }),
    },
  ]);
  const api = new ApiClient("https://api.example.com", fetchFn);
  const result = await api.pollDeviceFlow(CLIENT, "dc-1");
  assert.ok(result instanceof DeviceFlowError);
  assert.equal(result.retryable, true);
});

test("poll returns rotating tokens on approval", async () => {
  const { fetchFn } = scriptedFetch([
    {
      match: (path) => path === "/api/auth/oauth2/token",
      respond: (body) => {
        assert.equal(
          body.grant_type,
          "urn:ietf:params:oauth:grant-type:device_code",
        );
        assert.equal(body.resource, "urn:xbond:api:subscription");
        return {
          status: 200,
          json: {
            access_token: "at-1",
            refresh_token: "rt-1",
            expires_in: 3600,
            scope: "api",
          },
        };
      },
    },
  ]);
  const api = new ApiClient("https://api.example.com", fetchFn);
  const tokens = await api.pollDeviceFlow(CLIENT, "dc-1");
  assert.ok(!(tokens instanceof DeviceFlowError));
  if (tokens instanceof DeviceFlowError) return;
  assert.equal(tokens.accessToken, "at-1");
  assert.equal(tokens.refreshToken, "rt-1");
  assert.ok(tokens.accessTokenExpiresAt > Date.now());
});

test("refresh posts the rotation grant and carries both tokens", async () => {
  const { fetchFn, requests } = scriptedFetch([
    {
      match: (path) => path === "/api/auth/oauth2/token",
      respond: (body) => {
        assert.equal(body.grant_type, "refresh_token");
        assert.equal(body.refresh_token, "rt-old");
        return {
          status: 200,
          json: {
            access_token: "at-2",
            refresh_token: "rt-new",
            expires_in: 600,
          },
        };
      },
    },
  ]);
  const api = new ApiClient("https://api.example.com", fetchFn);
  const tokens = await api.refreshTokens(CLIENT, "rt-old");
  assert.equal(tokens.refreshToken, "rt-new");
  assert.equal(requests.length, 1);
});

test("extension config is parsed and the entitlement summary is surfaced", async () => {
  const { fetchFn } = scriptedFetch([
    {
      match: (path) => path === "/api/subscription/extension-config",
      respond: () => ({
        status: 200,
        json: {
          configVersion: 1,
          issuanceVersion: "cred-1700000000000",
          ingress: { hosts: ["proxy.example.com"], port: 8444, tls: true },
          auth: { method: "basic", username: "xbond", credential: "px-test" },
          rules: [],
          defaultAction: "proxy",
          label: "XBond",
          entitlement: {
            dataUsedBytes: 250,
            dataLimitBytes: 1000,
            servicePeriodEnd: "2030-01-01T00:00:00.000Z",
          },
        },
      }),
    },
  ]);
  const api = new ApiClient("https://api.example.com", fetchFn);
  const { config, entitlement } = await api.fetchExtensionConfig("at-1");
  assert.equal(config.issuanceVersion, "cred-1700000000000");
  assert.equal(config.ingress.port, 8444);
  assert.equal(entitlement?.dataUsedBytes, 250);
});

test("config endpoint 503 maps to a retryable ingress error and 401 to a hard error", async () => {
  const { fetchFn } = scriptedFetch([
    {
      match: (path) => path === "/api/subscription/extension-config",
      respond: () => ({
        status: 503,
        json: { error: "Browser ingress is not currently available" },
      }),
    },
  ]);
  const api = new ApiClient("https://api.example.com", fetchFn);
  await assert.rejects(
    () => api.fetchExtensionConfig("at-1"),
    (error: unknown) =>
      error instanceof DeviceFlowError &&
      error.code === "ingress_unavailable" &&
      error.retryable,
  );
});
