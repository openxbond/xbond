/**
 * 延遲藥丸的共用形制：彩點＋文字＋延遲色底、無邊框（首頁當前節點卡與
 * 節點卡的語言）。策略組行與節點卡引用同一份，避免同一延遲語義出現兩套
 * 皮膚。字級走 caption（DESIGN 八步內）。
 */
export type DelayPillTone =
  | "fast"
  | "medium"
  | "slow"
  | "failed"
  | "testing"
  | "untested"
  | "builtin";

export const DELAY_PILL_BASE =
  "inline-flex items-center gap-1.5 rounded-full bg-inset px-2 py-[3px] text-caption font-semibold leading-[1.2] tabular-nums transition-colors duration-200";

export const DELAY_PILL_TONES: Record<DelayPillTone, string> = {
  fast: "bg-latency-good text-latency-good-text",
  medium: "bg-latency-medium text-latency-medium-text",
  slow: "bg-latency-slow text-latency-slow-text",
  failed: "bg-latency-failed text-latency-failed-text",
  testing: "animate-pulse bg-brand-soft text-brand-text",
  untested: "text-muted-foreground",
  builtin: "font-medium text-muted-foreground",
};

export const DELAY_PILL_DOTS: Partial<Record<DelayPillTone, string>> = {
  fast: "bg-latency-good-dot",
  medium: "bg-latency-medium-dot",
  slow: "bg-latency-slow-dot",
};

/** 只有拿到實際延遲值的 tone 才渲染彩點。 */
export function hasDelayDot(tone: DelayPillTone): boolean {
  return tone === "fast" || tone === "medium" || tone === "slow";
}
