#!/usr/bin/env node
import { execSync } from "node:child_process";

console.log("=== XBond Android Smoke Test ===");

// 1. Verify ADB connection
let adbDevice = "";
try {
  const devices = execSync("adb devices", { encoding: "utf-8" });
  const lines = devices.trim().split("\n").slice(1);
  const active = lines.find((l) => l.includes("\tdevice"));
  if (!active) {
    console.error(
      "❌ No ADB device online. Ensure an Android device or emulator is connected (e.g. `adb devices` or `adb connect <device-ip>:5555`).",
    );
    process.exit(1);
  }
  adbDevice = active.split("\t")[0];
  console.log(`✅ ADB device connected: ${adbDevice}`);
} catch (e) {
  console.error("❌ Failed to query ADB:", e.message);
  process.exit(1);
}

// 2. Ensure net.xbond.app is running
let pid = "";
try {
  pid = execSync("adb shell pidof net.xbond.app", { encoding: "utf-8" }).trim();
} catch {}

if (!pid) {
  console.log("⚡ Launching net.xbond.app...");
  execSync("adb shell am start -n net.xbond.app/.MainActivity", {
    stdio: "ignore",
  });
  // Wait for startup
  for (let i = 0; i < 15; i++) {
    execSync("sleep 0.5");
    try {
      pid = execSync("adb shell pidof net.xbond.app", {
        encoding: "utf-8",
      }).trim();
      if (pid) break;
    } catch {}
  }
}

if (!pid) {
  console.error("❌ net.xbond.app failed to start.");
  process.exit(1);
}
console.log(`✅ App running with PID: ${pid}`);

// 3. Forward DevTools socket
try {
  execSync(`adb forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
  console.log("✅ DevTools port forwarded (tcp:9222)");
} catch (e) {
  console.error("❌ Failed to forward DevTools port:", e.message);
  process.exit(1);
}

// 4. Query LocalAPI status via WebView
let status;
try {
  const targetRes = await fetch("http://127.0.0.1:9222/json");
  const targets = await targetRes.json();
  const target = targets.find((t) => t.type === "page");
  if (!target) throw new Error("No page target found");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, rej) => {
    ws.onopen = r;
    ws.onerror = rej;
  });

  const evalPromise = new Promise((resolve, reject) => {
    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.id === 1) resolve(data.result);
    };
    ws.onerror = reject;
  });

  ws.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `(async () => {
          const token = document.querySelector("meta[name=\\"localapi-token\\"]")?.getAttribute("content");
          if (!token) return { error: "no-token" };
          const res = await fetch("/localapi/v0/status", {
            headers: { "X-XBond-Token": token }
          });
          return await res.json();
        })()`,
        awaitPromise: true,
        returnByValue: true,
      },
    }),
  );

  const res = await evalPromise;
  status = res?.result?.value;
  ws.close();
} catch (e) {
  console.error("❌ Failed to query LocalAPI status via DevTools:", e.message);
}

if (!status || status.error) {
  console.error("❌ LocalAPI did not return a valid status:", status);
  process.exit(1);
}

const vpnStateNames = {
  0: "IDLE",
  1: "CONNECTING",
  2: "CONNECTED",
  3: "DISCONNECTING",
  4: "ERROR",
};
console.log(`✅ LocalAPI online:`);
console.log(
  `   - VPN State: ${vpnStateNames[status.vpnState] ?? status.vpnState}`,
);
console.log(
  `   - Core: ${status.engine?.core ?? "none"} (running: ${status.engine?.running})`,
);
console.log(
  `   - Takeover: ${status.engine?.takeoverMode ?? "none"}, Routing: ${status.engine?.routingMode ?? "none"}`,
);
console.log(
  `   - Active Sub: ${status.activeSub?.name ?? "none"} (${status.activeSub?.format ?? "none"})`,
);

// 5. Test real egress if connected
if (status.vpnState === 2) {
  // Test ping
  try {
    const pingOut = execSync("adb shell ping -c 2 -W 2 1.1.1.1", {
      encoding: "utf-8",
    });
    const match = pingOut.match(/min\/avg\/max[^\n]+/);
    console.log(`✅ ICMP Ping (1.1.1.1): ${match ? match[0] : "ok"}`);
  } catch (e) {
    console.warn("⚠️ ICMP Ping failed:", e.message.slice(0, 80));
  }

  // Test real HTTP egress
  try {
    const curlHeader = execSync(
      "adb shell curl -s -I -m 10 https://www.google.com",
      { encoding: "utf-8" },
    );
    const firstLine = curlHeader.split("\n")[0].trim();
    if (
      firstLine.includes("200") ||
      firstLine.includes("301") ||
      firstLine.includes("302")
    ) {
      console.log(
        `✅ Internet Egress (curl https://www.google.com): ${firstLine}`,
      );
    } else {
      console.warn(`⚠️ Egress returned unexpected status: ${firstLine}`);
    }
  } catch (e) {
    console.error(
      "❌ Egress test failed (curl https://www.google.com):",
      e.message.slice(0, 100),
    );
    process.exit(1);
  }
} else {
  console.log(
    "ℹ️ VPN is not currently connected. Call /localapi/v0/up to connect.",
  );
}

// 6. Capture screenshot
const screenshotPath = "/tmp/xbond-android-smoke.png";
try {
  execSync(`adb exec-out screencap -p > ${screenshotPath}`);
  console.log(`✅ UI Screenshot saved to: ${screenshotPath}`);
} catch (e) {
  console.warn("⚠️ Failed to capture screenshot:", e.message);
}

console.log("=== Smoke Test Completed Successfully! ===");
