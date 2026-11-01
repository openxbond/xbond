// 扩展配置与状态契约（与 Cloud 签发的 extension-config v1 对齐）。本文件刻意
// 不依赖任何宿主 API：background、popup、管理页与 node 单测共用同一份定义。

/** extension-config v1：Cloud 版本化签发 / 手动配置共用的运行配置。 */
export type ExtensionConfig = {
  /** 配置模式，恒为 1；未知模式拒绝（fail loud，不做静默兼容）。 */
  configVersion: 1;
  /** 签发版本：凭据轮换或入口变化时更新，用于刷新去重与诊断展示。 */
  issuanceVersion: string;
  /** HTTPS 代理入口：浏览器 TLS 直连的 host:port 列表（tls 恒为 true，浏览器不接受明文代理）。 */
  ingress: { hosts: string[]; port: number };
  /** 代理认证：407 Basic，password 携带凭据（Proxy Token），username 仅为展示标签。 */
  auth: { method: "basic"; username: string; credential: string };
  /**
   * 域名分流规则（仅限可验证的 host 匹配：精确或 *.后缀）。内核规则、
   * 进程/端口/IP 段规则不在 PAC 能力范围内——出现在配置里即整条拒绝并在
   * 状态里报告，绝不静默忽略或回退 DIRECT。
   */
  rules: HostRule[];
  /** 规则未命中时的默认去向。 */
  defaultAction: "proxy" | "direct";
  /** 入口不可用时的诊断标签（签发方填写），手动配置缺省。 */
  label?: string;
};

export type HostRule = { pattern: string; action: "proxy" | "direct" };

/** 扩展的运行模式：global = 全部流量经入口；rules = PAC 按规则分流。 */
export type ProxyMode = "global" | "rules";

/** 扩展持久化偏好（storage.local）。 */
export type ExtensionPrefs = {
  /** 用户开关：false = 释放本扩展的代理设置（clear，不写显式直连）。 */
  enabled: boolean;
  mode: ProxyMode;
};

/**
 * 扩展状态机的对外形态：popup / 管理页据此渲染。错误态必须可见——代理不可达、
 * 认证失败、控制权丢失都不允许静默直连兜底。
 */
export type ProxyState =
  | { kind: "off" }
  | { kind: "ok"; mode: ProxyMode; label: string; issuanceVersion: string }
  | { kind: "no-config" }
  | { kind: "auth-failed"; detail: string }
  | { kind: "unreachable"; detail: string }
  | { kind: "control-lost"; holder: string }
  | { kind: "invalid-config"; detail: string }
  | { kind: "error"; detail: string };

/** popup / 管理页 → background 的消息。 */
export type ExtensionMessage =
  | { type: "get-state" }
  | { type: "get-events" }
  | { type: "set-enabled"; enabled: boolean }
  | { type: "set-mode"; mode: ProxyMode }
  | { type: "set-manual-config"; config: unknown };

/** background → 各页面的状态广播。 */
export type StateMessage = { type: "state"; state: ProxyState };

/** 诊断事件（管理页展示的运行日志环）。 */
export type DiagnosticEvent = {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
};
