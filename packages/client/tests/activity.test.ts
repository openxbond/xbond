import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterConnections,
  filterLogs,
  formatRate,
  type ConnectionItem,
  type LogItem,
} from "../src/activity.ts";

test("formatRate correctly converts byte rates into readable units", () => {
  assert.equal(formatRate(0), "0 B/s");
  assert.equal(formatRate(-50), "0 B/s");
  assert.equal(formatRate(NaN), "0 B/s");

  assert.equal(formatRate(500), "500.00 B/s");
  assert.equal(formatRate(1024), "1.00 KiB/s");
  assert.equal(formatRate(1048576), "1.00 MiB/s");
  assert.equal(formatRate(1073741824 * 3), "3.00 GiB/s");
});

test("filterConnections filters by host, process, rule and multi-field keyword", () => {
  const connections: ConnectionItem[] = [
    {
      id: "conn-1",
      metadata: {
        host: "api.github.com",
        destinationIP: "140.82.114.6",
        destinationPort: "443",
        sourceIP: "192.168.1.10",
        network: "tcp",
        type: "HTTPS",
        processPath: "/usr/bin/git",
      },
      rule: "Match",
      rulePayload: "DOMAIN-SUFFIX",
      chains: ["PROXY", "HK-01"],
      upload: 1024,
      download: 8192,
    },
    {
      id: "conn-2",
      metadata: {
        host: "www.google.com",
        destinationIP: "142.250.190.4",
        destinationPort: "443",
        sourceIP: "192.168.1.20",
        network: "tcp",
        type: "HTTPS",
        processPath: "/Applications/Google Chrome.app",
      },
      rule: "Google",
      rulePayload: "DOMAIN-KEYWORD",
      chains: ["PROXY", "JP-01"],
      upload: 4096,
      download: 65536,
    },
    {
      id: "conn-3",
      metadata: {
        host: "internal.corp",
        destinationIP: "10.0.0.5",
        destinationPort: "80",
        sourceIP: "192.168.1.10",
        network: "tcp",
        type: "HTTP",
        processPath: "/usr/bin/curl",
      },
      rule: "DIRECT",
      chains: ["DIRECT"],
      upload: 512,
      download: 1024,
    },
  ];

  // 1. Filter by host
  const githubOnly = filterConnections(connections, { host: "github" });
  assert.equal(githubOnly.length, 1);
  assert.equal(githubOnly[0].id, "conn-1");

  // 2. Filter by process
  const chromeOnly = filterConnections(connections, { process: "chrome" });
  assert.equal(chromeOnly.length, 1);
  assert.equal(chromeOnly[0].id, "conn-2");

  // 3. Filter by rule
  const directOnly = filterConnections(connections, { rule: "DIRECT" });
  assert.equal(directOnly.length, 1);
  assert.equal(directOnly[0].id, "conn-3");

  // 4. Combined keyword across chain/host/type
  const jpChains = filterConnections(connections, { keyword: "JP-01" });
  assert.equal(jpChains.length, 1);
  assert.equal(jpChains[0].id, "conn-2");

  // 5. Empty filter returns all
  assert.equal(filterConnections(connections, {}).length, 3);
});

test("filterLogs filters by log level and keyword", () => {
  const logs: LogItem[] = [
    { type: "info", payload: "[TCP] connection opened to 1.1.1.1:53" },
    {
      type: "warning",
      payload: "[Rule] unmatched domain falling back to proxy",
    },
    { type: "error", payload: "[Dial] handshake timeout after 5000ms" },
    { type: "debug", payload: "[DNS] cache hit for example.com" },
    { type: "info", payload: "[TCP] connection closed" },
  ];

  // 1. Filter by level
  const infoLogs = filterLogs(logs, undefined, "info");
  assert.equal(infoLogs.length, 2);

  const errorLogs = filterLogs(logs, undefined, "error");
  assert.equal(errorLogs.length, 1);
  assert.equal(errorLogs[0].payload, "[Dial] handshake timeout after 5000ms");

  // 2. Filter by keyword
  const tcpLogs = filterLogs(logs, "TCP");
  assert.equal(tcpLogs.length, 2);

  // 3. Filter by both level and keyword
  const warningRule = filterLogs(logs, "falling back", "warning");
  assert.equal(warningRule.length, 1);

  const noneMatch = filterLogs(logs, "falling back", "error");
  assert.equal(noneMatch.length, 0);

  // 4. "all" level returns all matching keyword
  assert.equal(filterLogs(logs, "", "all").length, 5);
});
