import type { SystemProxyDrift } from "@xbond/client/localapi";

export type SysproxyDriftReason = NonNullable<SystemProxyDrift["reasonCode"]>;

export interface SysproxyDriftView {
  reason: SysproxyDriftReason;
  /** connect-namespace key of the short drift sentence shared by the
   * takeover bar and the hero note. */
  messageKey: `sysproxyDrift.${SysproxyDriftReason}`;
}

/**
 * 漂移條只為「已接管且被外部改動」的系統代理存在：健康狀態、他人設定與
 * 未接管的意圖都不渲染任何差異界面（與 daemon 的判定條件一致）。
 */
export function sysproxyDriftView(
  drift: SystemProxyDrift | undefined,
): SysproxyDriftView | null {
  if (!drift?.drifted || !drift.reasonCode) return null;
  return {
    reason: drift.reasonCode,
    messageKey: `sysproxyDrift.${drift.reasonCode}`,
  };
}
