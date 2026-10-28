declare const __APP_VERSION__: string | undefined;

export const DASHBOARD_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.3.0";

export interface ClientInfo {
  type: string;
  version: string;
  premium: boolean;
  meta: boolean;
}

export function parseClientInfo(
  rawVersion: string,
  isClashX = false,
  premium = false,
  meta = false,
): ClientInfo {
  const v = (rawVersion || "").trim();
  const lower = v.toLowerCase();

  let type = "Clash";
  let cleanVersion = v;

  if (isClashX) {
    type = "ClashX";
  } else if (lower.includes("sing-box")) {
    type = "sing-box";
    cleanVersion = v.replace(/sing-box/i, "").trim();
  } else if (lower.includes("mihomo")) {
    type = "Mihomo";
    cleanVersion = v.replace(/mihomo/i, "").trim();
  } else if (lower.includes("meta") || meta) {
    type = "Clash.Meta";
    cleanVersion = v.replace(/clash\.meta|meta/i, "").trim();
  } else if (premium) {
    type = "Clash Premium";
  }

  return {
    type,
    version: cleanVersion || v,
    premium,
    meta,
  };
}
