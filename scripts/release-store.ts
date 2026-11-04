import { sign } from "node:crypto";
import fs from "node:fs";
import { setTimeout } from "node:timers/promises";

import { releaseVersion } from "./release-version.ts";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(90_000),
    ...init,
  });
  if (!response.ok)
    throw new Error(
      `Store API failed (${response.status}): ${new URL(url).pathname}`,
    );
  return response;
}

async function waitFor(
  status: () => Promise<string>,
  pending: string,
  success: string,
) {
  for (let i = 0; i < 30; i++) {
    const value = await status();
    if (value === success) return;
    if (value !== pending)
      throw new Error(`Unexpected store operation status: ${value}`);
    await setTimeout(4_000);
  }
  throw new Error(
    "The store operation is still processing. Check its status before submitting again.",
  );
}

async function chrome(command: string, version: string, file?: string) {
  const account = JSON.parse(required("CHROME_SERVICE_ACCOUNT"));
  const tokenEndpoint = "https://oauth2.googleapis.com/token";
  const iat = Math.floor(Date.now() / 1000);
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const message = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/chromewebstore",
    aud: tokenEndpoint,
    iat,
    exp: iat + 1800,
  })}`;
  const assertion = `${message}.${sign("RSA-SHA256", Buffer.from(message), account.private_key).toString("base64url")}`;
  const { access_token } = await (
    await request(tokenEndpoint, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    })
  ).json();
  const headers = { Authorization: `Bearer ${access_token}` };
  const item = `publishers/${encodeURIComponent(required("CHROME_PUBLISHER_ID"))}/items/${encodeURIComponent(required("CHROME_ITEM_ID"))}`;
  const host = "https://chromewebstore.googleapis.com";
  const endpoint = `${host}/v2/${item}`;
  const fetchStatus = async () =>
    (await request(endpoint + ":fetchStatus", { headers })).json();
  const status = await fetchStatus();
  const published = status.publishedItemRevisionStatus;
  const submitted = status.submittedItemRevisionStatus;
  const live =
    !status.takenDown &&
    published?.distributionChannels?.some(
      (channel: { crxVersion: string; deployPercentage: number }) =>
        channel.crxVersion === version && channel.deployPercentage === 100,
    );
  if (command === "status") {
    console.log(
      JSON.stringify({ live: Boolean(live), published, submitted }, null, 2),
    );
    return;
  }
  if (
    live ||
    submitted?.distributionChannels?.some(
      (channel: { crxVersion: string }) => channel.crxVersion === version,
    )
  ) {
    console.log(`Chrome already has ${version}`);
    return;
  }
  if (!file) throw new Error("Missing extension ZIP");
  const uploaded = await (
    await request(`${host}/upload/v2/${item}:upload`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/zip" },
      body: new Uint8Array(fs.readFileSync(file)),
    })
  ).json();
  if (uploaded.uploadState === "UPLOAD_IN_PROGRESS") {
    await waitFor(
      async () => (await fetchStatus()).lastAsyncUploadState,
      "UPLOAD_IN_PROGRESS",
      "SUCCEEDED",
    );
  } else if (
    uploaded.uploadState !== "SUCCEEDED" ||
    uploaded.crxVersion !== version
  ) {
    throw new Error("Chrome did not accept the expected extension version");
  }
  const submission = await (
    await request(endpoint + ":publish", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        deployInfos: [{ deployPercentage: 100 }],
        blockOnWarnings: true,
      }),
    })
  ).json();
  console.log(`Chrome submission: ${submission.state}`);
}

async function edge(command: string, version: string, file?: string) {
  const product = encodeURIComponent(required("EDGE_PRODUCT_ID"));
  const endpoint = `https://api.addons.microsoftedge.microsoft.com/v1/products/${product}/submissions`;
  const headers = {
    Authorization: `ApiKey ${required("EDGE_API_KEY")}`,
    "X-ClientID": required("EDGE_CLIENT_ID"),
  };
  const status = async (scope: string, id: string) => {
    const response = await request(
      `${endpoint}${scope}/operations/${encodeURIComponent(id)}`,
      { headers },
    );
    return response.json();
  };
  if (command === "status") {
    console.log(
      JSON.stringify(await status("", required("EDGE_OPERATION_ID")), null, 2),
    );
    return;
  }
  if (!file) throw new Error("Missing extension ZIP");
  const upload = await request(endpoint + "/draft/package", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/zip" },
    body: new Uint8Array(fs.readFileSync(file)),
  });
  const operation = (response: Response) => {
    const id = response.headers.get("location")?.split("/").at(-1);
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id))
      throw new Error("Edge did not return an operation ID");
    return id;
  };
  await waitFor(
    async () => (await status("/draft/package", operation(upload))).status,
    "InProgress",
    "Succeeded",
  );
  const submission = await request(endpoint, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ notes: `XBond ${version}` }),
  });
  const id = operation(submission);
  console.log(`Edge submission operation ID: ${id}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Edge submission for ${version}: \`${id}\`\n`,
    );
  await waitFor(
    async () => (await status("", id)).status,
    "InProgress",
    "Succeeded",
  );
}

const [store, command, tag, file] = process.argv.slice(2);
const { version } = releaseVersion(tag);
if (command !== "status" && command !== "submit")
  throw new Error("Expected submit or status");
if (store === "chrome") await chrome(command, version, file);
else if (store === "edge") await edge(command, version, file);
else throw new Error("Expected chrome or edge");
