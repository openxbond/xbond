// 管理页：账户（设备流登录/登出/权益摘要）+ 代理开关与模式 + 手动入口 +
// 诊断事件。全部经消息通道与 background 交互，不直接触碰 chrome.proxy；
// 设备流验证页在用户点击时才打开。

import { buildManualConfig } from "../shared/config.ts";
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
const modeBox = document.getElementById("mode") as HTMLSelectElement;
const eventsBox = document.getElementById("events") as HTMLDivElement;
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
const entitlementBox = document.getElementById(
  "entitlement",
) as HTMLParagraphElement;

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

function describe(state: ProxyState): { text: string; bad: boolean } {
  switch (state.kind) {
    case "off":
      return { text: `${tr("proxy")}: ${tr("off")}`, bad: false };
    case "ok":
      return {
        text: `${tr("on")} · ${state.mode} · ${state.label} · config ${state.issuanceVersion}`,
        bad: false,
      };
    case "no-config":
      return { text: tr("noConfig"), bad: true };
    case "signed-out":
      return { text: tr("signedOut"), bad: false };
    case "pending-login":
      return {
        text: `${tr("waitingApproval")} ${tr("userCode")}: ${state.userCode}`,
        bad: false,
      };
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
  const view = describe(state);
  stateBox.textContent = view.text;
  stateBox.className = view.bad ? "bad" : "ok";
  enabledBox.checked = state.kind !== "off";
  modeBox.value = state.kind === "ok" ? state.mode : "global";

  // 账户区随状态切换：未登录可见登录；登录中可见码 + 验证链接 + 取消；
  // 已登录（有权益摘要）可见登出与刷新。
  const pending = state.kind === "pending-login";
  const signedIn =
    state.kind === "ok" ||
    state.kind === "unreachable" ||
    state.kind === "auth-failed";
  signInButton.hidden = pending || signedIn;
  cancelButton.hidden = !pending;
  signOutButton.hidden = !signedIn;
  refreshButton.hidden = !signedIn;
  loginInfo.hidden = !pending;
  if (pending) {
    userCodeBox.textContent = `${tr("userCode")}: ${state.userCode}`;
    const href = state.verificationUriComplete ?? state.verificationUri;
    verificationLink.href = href;
    verificationLink.textContent = tr("openVerification");
  }
  if (state.kind === "ok" && state.entitlement) {
    const used = Math.floor(
      (state.entitlement.dataUsedBytes /
        Math.max(state.entitlement.dataLimitBytes, 1)) *
        100,
    );
    entitlementBox.hidden = false;
    entitlementBox.textContent = `${tr("usage")}: ${used}% · ${tr("expires")}: ${state.entitlement.servicePeriodEnd.slice(0, 10)}`;
  } else {
    entitlementBox.hidden = true;
  }

  void renderEvents();
}

async function refresh(): Promise<void> {
  render((await send({ type: "get-state" })) as ProxyState);
}

signInButton.addEventListener("click", async () => {
  const state = (await send({ type: "login-start" })) as ProxyState;
  render(state);
  if (state.kind === "pending-login") {
    chrome.tabs.create({
      url: state.verificationUriComplete ?? state.verificationUri,
    });
  }
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

document.getElementById("apply")?.addEventListener("click", () => {
  const host = (
    document.getElementById("host") as HTMLInputElement
  ).value.trim();
  const port = Number(
    (document.getElementById("port") as HTMLInputElement).value,
  );
  const credential = (
    document.getElementById("credential") as HTMLInputElement
  ).value.trim();
  const config = buildManualConfig({ host, port, credential });
  void send({ type: "set-manual-config", config });
});

enabledBox.addEventListener("change", () => {
  void send({ type: "set-enabled", enabled: enabledBox.checked });
});

modeBox.addEventListener("change", () => {
  void send({
    type: "set-mode",
    mode: modeBox.value === "rules" ? "rules" : "global",
  });
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
