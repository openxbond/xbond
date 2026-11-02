// 管理页：账户（XBond 账号登录/登出、设备码）、模式与策略组选择、节点清单、
// 用量与诊断事件。全部经消息通道与 background 交互，不直接触碰 chrome.proxy。

import type { ExtensionMessage, ProxyState } from "../background/engine.ts";
import type { ExtensionConfig } from "../shared/extension-config.ts";
import { translator } from "../shared/i18n.ts";
import { resolveLeaf, type Selection } from "../shared/workspace.ts";

const tr = translator(navigator.language);

function send(message: ExtensionMessage): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response));
  });
}

const stateBox = document.getElementById("state") as HTMLDivElement;
const enabledBox = document.getElementById("enabled") as HTMLInputElement;
const modeBox = document.getElementById("mode") as HTMLSelectElement;
const signInButton = document.getElementById("sign-in") as HTMLButtonElement;
const cancelButton = document.getElementById(
  "cancel-login",
) as HTMLButtonElement;
const signOutButton = document.getElementById("sign-out") as HTMLButtonElement;
const refreshButton = document.getElementById(
  "refresh-config",
) as HTMLButtonElement;
const loginInfo = document.getElementById("login-info") as HTMLDivElement;
const userCodeBox = document.getElementById(
  "user-code",
) as HTMLParagraphElement;
const verificationLink = document.getElementById(
  "verification-link",
) as HTMLAnchorElement;
const groupsBox = document.getElementById("groups") as HTMLDivElement;
const nodesBox = document.getElementById("nodes") as HTMLDivElement;
const quotaBox = document.getElementById("quota") as HTMLParagraphElement;
const eventsBox = document.getElementById("events") as HTMLDivElement;

let config: ExtensionConfig | null = null;
let currentState: ProxyState = { kind: "off" };

function describe(state: ProxyState): { text: string; bad: boolean } {
  switch (state.kind) {
    case "off":
      return { text: `${tr("proxy")}: ${tr("off")}`, bad: false };
    case "ok":
      return {
        text: `${tr("on")} · ${state.mode} · ${state.nodeCount} ${tr("nodes")}`,
        bad: false,
      };
    case "signed-out":
      return { text: tr("noSubscription"), bad: true };
    case "pending-login":
      return {
        text: `${tr("waitingApproval")} · ${tr("userCode")}: ${state.userCode}`,
        bad: false,
      };
    case "no-config":
      return { text: tr("noSubscription"), bad: true };
    case "auth-failed":
      return { text: `${tr("authFailed")} — ${state.detail}`, bad: true };
    case "unreachable":
      return { text: `${tr("unreachable")} — ${state.detail}`, bad: true };
    case "control-lost":
      return { text: `${tr("controlLost")} ${state.holder}`, bad: true };
    case "invalid-config":
      return { text: `${tr("invalidConfig")} — ${state.detail}`, bad: true };
    case "error":
      return { text: `${tr("error")} — ${state.detail}`, bad: true };
  }
}

function renderGroups(selection: Selection): void {
  groupsBox.replaceChildren();
  if (!config) return;
  for (const group of config.groups.filter(
    (candidate) => candidate.type === "select",
  )) {
    const row = document.createElement("label");
    row.className = "row";
    const label = document.createElement("span");
    label.textContent = group.name;
    const select = document.createElement("select");
    for (const member of group.members) {
      const option = document.createElement("option");
      option.value = member;
      option.textContent = member;
      option.selected = selection[group.name] === member;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      void send({
        type: "set-selection",
        group: group.name,
        member: select.value,
      });
    });
    row.append(label, select);
    groupsBox.appendChild(row);
  }
}

function renderNodes(selection: Selection): void {
  nodesBox.replaceChildren();
  if (!config) return;
  for (const node of config.nodes) {
    const row = document.createElement("div");
    row.className = "node";
    const name = document.createElement("span");
    name.textContent = `${node.name} · ${node.server}:${node.port}`;
    row.appendChild(name);
    nodesBox.appendChild(row);
  }
  const primary = config.groups.find((group) => group.type === "select");
  if (primary) {
    try {
      const leaf = resolveLeaf(config, selection, primary.name);
      quotaBox.textContent = `${tr("currentExit")}: ${
        leaf.kind === "node"
          ? leaf.node.name
          : leaf.kind === "direct"
            ? tr("direct")
            : tr("reject")
      }`;
    } catch {
      quotaBox.textContent = `${tr("currentExit")}: ?`;
    }
  }
}

async function renderEvents(): Promise<void> {
  const result = (await send({ type: "get-events" })) as {
    events?: Array<{ at: number; level: string; message: string }>;
  };
  const events = result.events ?? [];
  eventsBox.textContent =
    events.length === 0
      ? tr("noEvents")
      : events
          .map(
            (event) =>
              `${new Date(event.at).toISOString()} [${event.level}] ${event.message}`,
          )
          .join("\n");
}

function render(state: ProxyState): void {
  currentState = state;
  const view = describe(state);
  stateBox.textContent = view.text;
  stateBox.className = view.bad ? "bad" : "ok";
  enabledBox.checked =
    state.kind === "ok" ||
    state.kind === "unreachable" ||
    state.kind === "auth-failed";
  modeBox.value = state.kind === "ok" ? state.mode : "rule";

  const pending = state.kind === "pending-login";
  const signedIn =
    state.kind === "ok" ||
    state.kind === "unreachable" ||
    state.kind === "auth-failed" ||
    state.kind === "control-lost";
  signInButton.hidden = pending || signedIn;
  cancelButton.hidden = !pending;
  signOutButton.hidden = !signedIn;
  loginInfo.hidden = !pending;
  refreshButton.hidden = !signedIn;
  if (pending) {
    userCodeBox.textContent = `${tr("userCode")}: ${state.userCode}`;
    const href = state.verificationUriComplete ?? state.verificationUri;
    verificationLink.href = href;
    verificationLink.textContent = tr("openVerification");
  }

  if (state.kind === "ok") {
    renderGroups(state.selection);
    renderNodes(state.selection);
    if (state.quota) {
      const used = state.quota.uploadBytes + state.quota.downloadBytes;
      const total = Math.max(state.quota.totalBytes, 1);
      const percent = Math.min(100, Math.floor((used / total) * 100));
      const expires = new Date(state.quota.expiresAt * 1000)
        .toISOString()
        .slice(0, 10);
      quotaBox.textContent = `${tr("quota")}: ${percent}% · ${tr("expires")}: ${expires}`;
    }
  }
  void renderEvents();
}

async function refresh(): Promise<void> {
  render((await send({ type: "get-state" })) as ProxyState);
}

function loadConfig(): void {
  chrome.storage.local.get("xbond.config", (items) => {
    config = (items["xbond.config"] as ExtensionConfig | undefined) ?? null;
    render(currentState);
  });
}

signInButton.addEventListener("click", async () => {
  render((await send({ type: "login-start" })) as ProxyState);
});

cancelButton.addEventListener("click", () => {
  void send({ type: "login-cancel" });
});

signOutButton.addEventListener("click", () => {
  void send({ type: "logout" });
});

refreshButton.addEventListener("click", () => {
  void send({ type: "refresh-config" });
});

enabledBox.addEventListener("change", () => {
  void send({ type: "set-enabled", enabled: enabledBox.checked });
});

modeBox.addEventListener("change", () => {
  void send({
    type: "set-mode",
    mode: modeBox.value as "rule" | "global" | "direct",
  });
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: string }).type === "state"
  ) {
    render((message as { state: ProxyState }).state);
    loadConfig();
  }
});

void refresh();
loadConfig();
