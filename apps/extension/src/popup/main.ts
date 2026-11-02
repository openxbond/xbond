// Popup：开关、模式、主节点、用量摘要、管理页入口。一切状态来自 background
// （storage 为事实源）；主节点选择改写主策略组的选中成员（≥ 400px 弹窗命中
// 移动端响应式布局）。

import type { ProxyState } from "../background/engine.ts";
import type { ExtensionMessage } from "../background/engine.ts";
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
const nodeBox = document.getElementById("node") as HTMLSelectElement;
const primaryLabel = document.getElementById(
  "primary-label",
) as HTMLLabelElement;
const manageLink = document.getElementById("manage") as HTMLAnchorElement;

let currentState: ProxyState = { kind: "off" };
let config: ExtensionConfig | null = null;

function primaryGroup(): { name: string; members: string[] } | null {
  const group = config?.groups.find((candidate) => candidate.type === "select");
  return group ? { name: group.name, members: group.members } : null;
}

function formatQuota(state: ProxyState): string {
  if (state.kind !== "ok" || !state.quota) return "";
  const used = state.quota.uploadBytes + state.quota.downloadBytes;
  const total = Math.max(state.quota.totalBytes, 1);
  const percent = Math.min(100, Math.floor((used / total) * 100));
  const expires = new Date(state.quota.expiresAt * 1000)
    .toISOString()
    .slice(0, 10);
  return ` · ${tr("quota")} ${percent}% · ${tr("expires")} ${expires}`;
}

function describe(state: ProxyState): { text: string; bad: boolean } {
  switch (state.kind) {
    case "off":
      return { text: `${tr("proxy")}: ${tr("off")}`, bad: false };
    case "ok": {
      const primary = primaryGroup();
      const selection: Selection = state.selection;
      let exit = "";
      if (config && primary) {
        try {
          const leaf = resolveLeaf(config, selection, primary.name);
          exit =
            leaf.kind === "direct"
              ? tr("direct")
              : leaf.kind === "reject"
                ? tr("reject")
                : leaf.node.name;
        } catch {
          exit = "?";
        }
      }
      return {
        text: `${tr("on")} · ${tr("currentExit")}: ${exit}${formatQuota(state)}`,
        bad: false,
      };
    }
    case "no-subscription":
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

function render(state: ProxyState): void {
  currentState = state;
  const view = describe(state);
  stateBox.textContent = view.text;
  stateBox.className = view.bad ? "bad" : "ok";
  enabledBox.checked = state.kind !== "off";
  modeBox.value = state.kind === "ok" ? state.mode : "rule";
  const primary = primaryGroup();
  primaryLabel.hidden = !primary || state.kind !== "ok";
  nodeBox.hidden = primaryLabel.hidden;
  if (primary && state.kind === "ok") {
    nodeBox.replaceChildren(
      ...primary.members.map((member) => {
        const option = document.createElement("option");
        option.value = member;
        option.textContent = member;
        option.selected = state.selection[primary.name] === member;
        return option;
      }),
    );
  }
}

// background 只下发状态摘要；完整配置由扩展页面直接读 storage（同源共享）。
function loadConfigForRender(): void {
  chrome.storage.local.get("xbond.config", (items) => {
    config = (items["xbond.config"] as ExtensionConfig | undefined) ?? null;
    render(currentState);
  });
}

async function refresh(): Promise<void> {
  render((await send({ type: "get-state" })) as ProxyState);
}

enabledBox.addEventListener("change", async () => {
  render(
    (await send({
      type: "set-enabled",
      enabled: enabledBox.checked,
    })) as ProxyState,
  );
});

modeBox.addEventListener("change", async () => {
  render(
    (await send({
      type: "set-mode",
      mode: modeBox.value as "rule" | "global" | "direct",
    })) as ProxyState,
  );
});

nodeBox.addEventListener("change", async () => {
  const primary = primaryGroup();
  if (!primary) return;
  render(
    (await send({
      type: "set-selection",
      group: primary.name,
      member: nodeBox.value,
    })) as ProxyState,
  );
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: string }).type === "state"
  ) {
    render((message as { state: ProxyState }).state);
    void loadConfigForRender();
  }
});

manageLink.addEventListener("click", (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("src/page/index.html") });
});

void refresh();
void loadConfigForRender();
