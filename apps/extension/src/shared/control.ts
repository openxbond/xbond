import type { ExtensionConfig, Quota } from "./extension-config.ts";
import type { WebsiteOverride } from "./routing.ts";
import type { Selection } from "./workspace.ts";

export type RoutingMode = "rule" | "global" | "direct";
export type ProxyState =
  | { kind: "off" | "ok" | "signed-out" | "no-config" | "pending-login" }
  | { kind: "auth-failed" | "unreachable" | "error"; detail: string }
  | { kind: "control-lost"; holder: string };
/** 请求记录上限：会话内环形截断（store 与捕获侧共用同一事实）。 */
export const REQUEST_RECORD_LIMIT = 500;
/** 一次登录流程的非成功结局：过期或未完成确认；成功与主动取消不落痕。 */
export type LoginEnded = "expired" | "failed";
export interface Preferences {
  theme: "system" | "light" | "dark";
  language: "system" | "en_US" | "zh_CN" | "zh_HK" | "ko" | "fa";
  autoUpdate: boolean;
  restore: boolean;
  focusedGroup: string;
}
export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  language: "system",
  autoUpdate: true,
  restore: true,
  focusedGroup: "",
};
export interface DiagnosticEvent {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}
export interface RequestRecord {
  id: string;
  at: number;
  host: string;
  type: string;
  status: "pending" | "completed" | "failed" | "interrupted";
  duration?: number;
  error?: string;
}
export interface Connectivity {
  status: "unknown" | "checking" | "ok" | "failed";
  target: string;
  at?: number;
  duration?: number;
  error?: string;
}
export interface GroupView {
  name: string;
  type: "select" | "urltest";
  members: string[];
  selected: string;
  path: string[];
}
export interface RuleView {
  condition: string;
  payload: string;
  target: string;
}
export interface ExtensionSnapshot {
  state: ProxyState;
  enabled: boolean;
  mode: RoutingMode;
  signedIn: boolean;
  pendingLogin: {
    userCode: string;
    verificationUri: string;
    expiresAt: number;
  } | null;
  /** 最近一次未完成的登录结局（过期/未确认）；重新发起登录即清除。 */
  loginEnded: LoginEnded | null;
  config: {
    available: boolean;
    updatedAt: number | null;
    error: string | null;
  };
  groups: GroupView[];
  nodes: Array<
    Pick<ExtensionConfig["nodes"][number], "name" | "server" | "port">
  >;
  rules: RuleView[];
  final: string;
  selection: Selection;
  globalExit: string;
  globalPath: string[];
  quota: Quota | null;
  preferences: Preferences;
  overrides: WebsiteOverride[];
  overrideErrors: string[];
  recording: boolean;
  requests: RequestRecord[];
  events: DiagnosticEvent[];
  connectivity: Connectivity;
  control: chrome.proxy.LevelOfControl | null;
  prediction: {
    host: string;
    source: "rule" | "final";
    target: string;
    path: string[];
    condition: string;
    dnsLimited: boolean;
  } | null;
}
export type ExtensionCommand =
  | {
      type:
        | "get-snapshot"
        | "reconcile"
        | "login-start"
        | "login-cancel"
        | "logout"
        | "refresh-config"
        | "clear-requests"
        | "clear-events"
        | "check-connectivity";
    }
  | { type: "set-enabled"; enabled: boolean }
  | { type: "set-mode"; mode: RoutingMode }
  | { type: "set-selection"; group: string; member: string }
  | { type: "set-preferences"; preferences: Preferences }
  | { type: "save-override"; override: WebsiteOverride }
  | { type: "delete-override"; id: string }
  | { type: "set-recording"; enabled: boolean }
  | { type: "predict-route"; host: string }
  | { type: "set-global-exit"; target: string };
export type ControlReply =
  | { ok: true; snapshot: ExtensionSnapshot }
  | { ok: false; error: string; snapshot?: ExtensionSnapshot };

export function parseCommand(value: unknown): ExtensionCommand | null {
  if (!value || typeof value !== "object" || !("type" in value)) return null;
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case "get-snapshot":
    case "reconcile":
    case "login-start":
    case "login-cancel":
    case "logout":
    case "refresh-config":
    case "clear-requests":
    case "clear-events":
    case "check-connectivity":
      return { type: v.type };
    case "set-enabled":
    case "set-recording":
      return typeof v.enabled === "boolean"
        ? { type: v.type, enabled: v.enabled }
        : null;
    case "set-mode":
      return v.mode === "rule" || v.mode === "global" || v.mode === "direct"
        ? { type: v.type, mode: v.mode }
        : null;
    case "set-selection":
      return typeof v.group === "string" && typeof v.member === "string"
        ? { type: v.type, group: v.group, member: v.member }
        : null;
    case "delete-override":
      return typeof v.id === "string" ? { type: v.type, id: v.id } : null;
    case "predict-route":
      return typeof v.host === "string" ? { type: v.type, host: v.host } : null;
    case "set-global-exit":
      return typeof v.target === "string"
        ? { type: v.type, target: v.target }
        : null;
    case "save-override": {
      if (!v.override || typeof v.override !== "object") return null;
      const r = v.override as Record<string, unknown>;
      return typeof r.id === "string" &&
        typeof r.domain === "string" &&
        typeof r.target === "string" &&
        typeof r.enabled === "boolean" &&
        (r.match === "exact" || r.match === "suffix")
        ? {
            type: v.type,
            override: {
              id: r.id,
              domain: r.domain,
              target: r.target,
              enabled: r.enabled,
              match: r.match,
            },
          }
        : null;
    }
    case "set-preferences": {
      if (!v.preferences || typeof v.preferences !== "object") return null;
      const p = v.preferences as Record<string, unknown>;
      const theme = p.theme;
      const language = p.language;
      return (theme === "system" || theme === "light" || theme === "dark") &&
        (language === "system" ||
          language === "en_US" ||
          language === "zh_CN" ||
          language === "zh_HK" ||
          language === "ko" ||
          language === "fa") &&
        typeof p.autoUpdate === "boolean" &&
        typeof p.restore === "boolean" &&
        typeof p.focusedGroup === "string"
        ? {
            type: v.type,
            preferences: {
              theme,
              language,
              autoUpdate: p.autoUpdate,
              restore: p.restore,
              focusedGroup: p.focusedGroup,
            },
          }
        : null;
    }
    default:
      return null;
  }
}
