// 管理页（骨架）：手动入口配置 + 状态 + 诊断事件。Cloud 账户链路（device
// flow OAuth、配置签发拉取）在 background 完成后接入；本页只经消息通道与
// background 交互，不直接触碰 chrome.proxy。

import { buildManualConfig } from "../shared/config.ts";
import type { ExtensionMessage, ProxyState } from "../shared/types.ts";

function send(message: ExtensionMessage): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response));
  });
}

const stateBox = document.getElementById("state") as HTMLDivElement;
const enabledBox = document.getElementById("enabled") as HTMLInputElement;
const modeBox = document.getElementById("mode") as HTMLSelectElement;
const eventsBox = document.getElementById("events") as HTMLDivElement;

async function renderEvents(): Promise<void> {
  const result = (await send({ type: "get-events" })) as {
    events?: Array<{ at: number; level: string; message: string }>;
  };
  const events = result.events ?? [];
  eventsBox.textContent =
    events.length === 0
      ? "no events yet"
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
      return { text: "off", bad: false };
    case "ok":
      return {
        text: `on · ${state.mode} · ${state.label} · config ${state.issuanceVersion}`,
        bad: false,
      };
    case "no-config":
      return { text: "on but no valid config", bad: true };
    case "auth-failed":
      return { text: `auth failed — ${state.detail}`, bad: true };
    case "unreachable":
      return { text: `ingress unreachable — ${state.detail}`, bad: true };
    case "control-lost":
      return { text: `proxy control held by ${state.holder}`, bad: true };
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
  modeBox.value = state.kind === "ok" ? state.mode : "global";
  void renderEvents();
}

async function refresh(): Promise<void> {
  render((await send({ type: "get-state" })) as ProxyState);
}

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
