/**
 * Primary navigation registry (design: client-rethink §二).
 *
 * The desktop shell exposes five destinations — 连接 / 策略 / 配置 / 活动 /
 * 设置 — and the mobile bottom bar keeps four: 配置 enters from the connect
 * page's config summary or settings, not its own tab. Rules are a secondary
 * view inside 策略; diagnostics live inside 活动. Former top-level routes
 * survive as redirects so old deep links keep working.
 */

export type NavName =
  | "Connect"
  | "Proxies"
  | "Subscriptions"
  | "Activity"
  | "Settings";

export interface NavRoute {
  path: string;
  name: NavName;
}

export const DESKTOP_NAV: NavRoute[] = [
  { path: "/connect", name: "Connect" },
  { path: "/proxies", name: "Proxies" },
  { path: "/subscriptions", name: "Subscriptions" },
  { path: "/activity", name: "Activity" },
  { path: "/settings", name: "Settings" },
];

export const MOBILE_NAV: NavRoute[] = [
  { path: "/connect", name: "Connect" },
  { path: "/proxies", name: "Proxies" },
  { path: "/activity", name: "Activity" },
  { path: "/settings", name: "Settings" },
];

/** Pre-NAV-01 top-level routes → their new secondary-view homes. */
export const NAV_REDIRECTS: Record<string, { to: string; view: string }> = {
  "/connections": { to: "/activity", view: "connections" },
  "/logs": { to: "/activity", view: "logs" },
  "/diagnostics": { to: "/activity", view: "diagnostics" },
  "/rules": { to: "/proxies", view: "rules" },
};
