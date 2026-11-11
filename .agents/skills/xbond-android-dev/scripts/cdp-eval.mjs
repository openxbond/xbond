#!/usr/bin/env node
import { execSync } from "node:child_process";

// Ensure port forward for active app process
let pid = "";
try {
  pid = execSync("adb shell pidof net.xbond.app", { encoding: "utf-8" }).trim();
  if (pid) {
    execSync(
      `adb forward tcp:9222 localabstract:webview_devtools_remote_${pid}`,
    );
  }
} catch {
  // If app is not running, warn and exit
  console.error("net.xbond.app is not running on ADB device.");
  process.exit(1);
}

let targets;
try {
  const targetRes = await fetch("http://127.0.0.1:9222/json");
  targets = await targetRes.json();
} catch (e) {
  console.error("Failed to connect to DevTools port 9222:", e.message);
  process.exit(1);
}

const target = targets.find((t) => t.type === "page");
if (!target) {
  console.error("No active page target found in WebView DevTools.");
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

const expr = process.argv.slice(2).join(" ") || "location.href";

let id = 1;
const call = (method, params = {}) =>
  new Promise((resolve) => {
    const reqId = id++;
    const handler = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.id === reqId) {
        ws.removeEventListener("message", handler);
        resolve(data.result);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id: reqId, method, params }));
  });

const res = await call("Runtime.evaluate", {
  expression: expr,
  returnByValue: true,
  awaitPromise: true,
});

if (res?.exceptionDetails) {
  console.error(
    "Exception:",
    res.exceptionDetails.text || res.exceptionDetails,
  );
  process.exit(1);
} else {
  const val = res?.result?.value;
  if (typeof val === "string") {
    console.log(val);
  } else {
    console.log(JSON.stringify(val, null, 2));
  }
}

ws.close();
