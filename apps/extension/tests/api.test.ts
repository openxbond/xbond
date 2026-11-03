import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiClient, ApiError } from "../src/shared/api.ts";

function scriptedFetch(
  routes: Array<{
    match: (path: string, init?: RequestInit) => boolean;
    respond: (init?: RequestInit) => {
      status: number;
      json: unknown;
      headers?: Record<string, string>;
    };
  }>,
) {
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const fetchFn = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    const path = url.replace(/^https:\/\/api\.example\.com/, "");
    requests.push({ path, init });
    const route = routes.find((r) => r.match(path, init));
    if (!route) throw new Error(`no route for ${path}`);
    const response = route.respond(init);
    return new Response(JSON.stringify(response.json), {
      status: response.status,
      headers: {
        "content-type": "application/json",
        ...response.headers,
      },
    });
  }) as typeof fetch;
  return { fetchFn, requests };
}

test("device flow start carries client, scope and resource", async () => {
  const { fetchFn, requests } = scriptedFetch([
    {
      match: (path) => path === "/api/auth/device/code",
      respond: () => ({
        status: 200,
        json: {
          device_code: "dc-1",
          user_code: "ABCD-EFGH",
          verification_uri: "https://www.xbond.net/auth/activate",
          verification_uri_complete:
            "https://www.xbond.net/auth/activate?user_code=ABCD-EFGH",
          expires_in: 600,
          interval: 3,
        },
      }),
    },
  ]);
  const api = new ApiClient("https://api.example.com", fetchFn);
  const start = await api.startDeviceFlow();
  assert.equal(start.deviceCode, "dc-1");
  assert.equal(start.userCode, "ABCD-EFGH");
  assert.equal(start.verificationUri, "https://www.xbond.net/auth/activate");
  assert.equal(
    start.verificationUriComplete,
    "https://www.xbond.net/auth/activate?user_code=ABCD-EFGH",
  );
  assert.equal(start.intervalSeconds, 3);
  const body = String(requests[0]?.init?.body ?? "");
  assert.ok(
    body.includes("scope=api+offline_access") ||
      body.includes("scope=api%20offline_access"),
  );
  assert.ok(body.includes("resource=urn%3Axbond%3Aapi%3Asubscription"));
  assert.ok(body.includes("client_id=xbond-app"));
});

test("poll maps authorization_pending to a retryable error", async () => {
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
  const result = await api.pollDeviceFlow("dc-1");
  assert.ok(result instanceof ApiError);
  assert.equal(result.retryable, true);
});

test("poll returns rotating tokens on approval", async () => {
  const { fetchFn } = scriptedFetch([
    {
      match: (path) => path === "/api/auth/oauth2/token",
      respond: () => ({
        status: 200,
        json: {
          access_token: "at-1",
          refresh_token: "rt-1",
          expires_in: 3600,
          scope: "api",
        },
      }),
    },
  ]);
  const api = new ApiClient("https://api.example.com", fetchFn);
  const tokens = await api.pollDeviceFlow("dc-1");
  assert.ok(!(tokens instanceof ApiError));
  if (tokens instanceof ApiError) return;
  assert.equal(tokens.accessToken, "at-1");
  assert.equal(tokens.refreshToken, "rt-1");
  assert.ok(tokens.accessTokenExpiresAt > Date.now());
});

test("config fetch uses the Bearer channel, parses the config and the quota header", async () => {
  const { fetchFn, requests } = scriptedFetch([
    {
      match: (path) => path === "/api/subscription/config?target=extension",
      respond: () => ({
        status: 200,
        headers: {
          "subscription-userinfo":
            "upload=0; download=250; total=1000; expire=1893456000",
        },
        json: {
          version: 1,
          proxyToken: "px-" + "11".repeat(24),
          nodes: [
            {
              name: "HK 01",
              server: "hk.example.com",
              port: 443,
              password: "aabbccddeeff00112233445566778899aabbccdd",
            },
          ],
          groups: [
            { name: "节点选择", type: "select", members: ["HK 01", "DIRECT"] },
          ],
          rules: [],
          ruleSets: {},
          final: "节点选择",
        },
      }),
    },
  ]);
  const api = new ApiClient("https://api.example.com", fetchFn);
  const { config, quota } = await api.fetchConfig("at-1");
  assert.equal(config.nodes[0]?.server, "hk.example.com");
  assert.equal(quota?.totalBytes, 1000);
  const headers = new Headers(requests[0]?.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer at-1");
});

test("401 on the config fetch is a hard sign-out signal; 503 is retryable", async () => {
  const unauthorized = scriptedFetch([
    { match: () => true, respond: () => ({ status: 401, json: {} }) },
  ]);
  const api = new ApiClient("https://api.example.com", unauthorized.fetchFn);
  await assert.rejects(
    () => api.fetchConfig("at-1"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.code === "config_unauthorized" &&
      !error.retryable,
  );

  const unavailable = scriptedFetch([
    { match: () => true, respond: () => ({ status: 503, json: {} }) },
  ]);
  const api2 = new ApiClient("https://api.example.com", unavailable.fetchFn);
  await assert.rejects(
    () => api2.fetchConfig("at-1"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.code === "ingress_unavailable" &&
      error.retryable,
  );
});
