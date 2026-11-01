// Popup：开关、模式、状态摘要、管理页入口（client-rethink §六 的 popup 范围）。
// 一切状态来自 background（storage 为事实源），popup 自身不持有状态。

import type { ExtensionMessage, ProxyState } from "../shared/types.ts";

function send(message: ExtensionMessage): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response));
  });
}

const stateBox = document.getElementById("state") as HTMLDivElement;
const enabledBox = document.getElementById("enabled") as HTMLInputElement;
const modeButton = document.getElementById("mode") as HTMLButtonElement;

function describe(state: ProxyState): { text: string; bad: boolean } {
  switch (state.kind) {
    case "off":
      return { text: "off", bad: false };
    case "ok":
      return { text: `on · ${state.mode} · ${state.label}`, bad: false };
    case "no-config":
      return { text: "no config — open manage", bad: true };
    case "auth-failed":
      return { text: `auth failed — ${state.detail}`, bad: true };
    case "unreachable":
      return { text: `ingress unreachable — ${state.detail}`, bad: true };
    case "control-lost":
      return { text: `control lost to ${state.holder}`, bad: true };
    case "invalid-config":
      return { text: `invalid config — ${state.detail}`, bad: true };
    case "error":
      return { text: `error — ${state.detail}`, bad: true };
  }
}

function render(state: ProxyState): void {
  const view = describe(state);
  stateBox.textContent = view.text;
  stateBox.className = view.bad ? "bad" : "ok";
  enabledBox.checked = state.kind !== "off";
  modeButton.textContent =
    state.kind === "ok" && state.mode === "rules"
      ? "switch to global"
      : "switch to rules";
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

modeButton.addEventListener("click", async () => {
  const current = (await send({ type: "get-state" })) as ProxyState;
  const next =
    current.kind === "ok" && current.mode === "rules" ? "global" : "rules";
  render((await send({ type: "set-mode", mode: next })) as ProxyState);
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: string }).type === "state"
  ) {
    render((message as { state: ProxyState }).state);
  }
});

void refresh();
