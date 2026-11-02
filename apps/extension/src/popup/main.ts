// Popup：开关、模式、状态摘要、登录入口、管理页链接（client-rethink §六 的
// popup 范围）。一切状态来自 background（storage 为事实源），popup 自身不持
// 有状态；登录验证页在用户点击时才打开。

import { translator } from "../shared/i18n.ts";
import type { ExtensionMessage, ProxyState } from "../shared/types.ts";

const tr = translator(navigator.language);

function send(message: ExtensionMessage): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response));
  });
}

const stateBox = document.getElementById("state") as HTMLDivElement;
const enabledBox = document.getElementById("enabled") as HTMLInputElement;
const modeButton = document.getElementById("mode") as HTMLButtonElement;
const actionButton = document.getElementById("action") as HTMLButtonElement;

let currentState: ProxyState = { kind: "off" };

function describe(state: ProxyState): {
  text: string;
  bad: boolean;
  signIn: boolean;
  cancel: boolean;
} {
  switch (state.kind) {
    case "off":
      return {
        text: `${tr("proxy")}: ${tr("off")}`,
        bad: false,
        signIn: false,
        cancel: false,
      };
    case "ok":
      return {
        text: `${tr("on")} · ${state.label}${state.entitlement ? ` · ${tr("usage")} ${Math.floor((state.entitlement.dataUsedBytes / Math.max(state.entitlement.dataLimitBytes, 1)) * 100)}%` : ""}`,
        bad: false,
        signIn: false,
        cancel: false,
      };
    case "no-config":
      return { text: tr("noConfig"), bad: true, signIn: true, cancel: false };
    case "signed-out":
      return { text: tr("signedOut"), bad: false, signIn: true, cancel: false };
    case "pending-login":
      return {
        text: `${tr("waitingApproval")} ${tr("userCode")}: ${state.userCode}`,
        bad: false,
        signIn: false,
        cancel: true,
      };
    case "auth-failed":
      return {
        text: `${tr("authFailed")} — ${state.detail}`,
        bad: true,
        signIn: false,
        cancel: false,
      };
    case "unreachable":
      return {
        text: `${tr("unreachable")} — ${state.detail}`,
        bad: true,
        signIn: false,
        cancel: false,
      };
    case "control-lost":
      return {
        text: `${tr("controlLost")} ${state.holder}`,
        bad: true,
        signIn: false,
        cancel: false,
      };
    case "invalid-config":
      return {
        text: `${tr("invalidConfig")} — ${state.detail}`,
        bad: true,
        signIn: false,
        cancel: false,
      };
    case "error":
      return {
        text: `${tr("error")} — ${state.detail}`,
        bad: true,
        signIn: false,
        cancel: false,
      };
  }
}

function render(state: ProxyState): void {
  currentState = state;
  const view = describe(state);
  stateBox.textContent = view.text;
  stateBox.className = view.bad ? "bad" : "ok";
  enabledBox.checked = state.kind !== "off";
  modeButton.textContent =
    state.kind === "ok" && state.mode === "rules"
      ? tr("switchToGlobal")
      : tr("switchToRules");
  actionButton.textContent = view.cancel ? tr("cancelLogin") : tr("signIn");
  actionButton.hidden = !view.signIn && !view.cancel;
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
  const next =
    currentState.kind === "ok" && currentState.mode === "rules"
      ? "global"
      : "rules";
  render((await send({ type: "set-mode", mode: next })) as ProxyState);
});

actionButton.addEventListener("click", async () => {
  if (currentState.kind === "pending-login") {
    render((await send({ type: "login-cancel" })) as ProxyState);
    return;
  }
  const state = (await send({ type: "login-start" })) as ProxyState;
  render(state);
  if (state.kind === "pending-login" && state.verificationUriComplete) {
    chrome.tabs.create({ url: state.verificationUriComplete });
  }
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
