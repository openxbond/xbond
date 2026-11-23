import type { PersonalNotification } from "@xbond/client/localapi";
import {
  Gift,
  Megaphone,
  ShieldAlert,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type AnnouncementCategoryKey =
  | "security"
  | "maintenance"
  | "notice"
  | "promo";

export interface CategoryStyle {
  key: AnnouncementCategoryKey;
  Icon: LucideIcon;
  badgeClass: string;
  accentClass: string;
}

const CATEGORY_STYLES: Record<AnnouncementCategoryKey, CategoryStyle> = {
  security: {
    key: "security",
    Icon: ShieldAlert,
    badgeClass: "border-destructive/30 bg-destructive/10 text-destructive-text",
    accentClass: "border-destructive/35 bg-destructive/5",
  },
  maintenance: {
    key: "maintenance",
    Icon: Wrench,
    badgeClass: "border-warning/35 bg-warning/15 text-warning-text",
    accentClass: "border-warning/35 bg-warning/10",
  },
  notice: {
    key: "notice",
    Icon: Megaphone,
    badgeClass: "border-info/30 bg-info/10 text-info-text",
    accentClass: "border-info/30 bg-info/5",
  },
  promo: {
    key: "promo",
    Icon: Sparkles,
    badgeClass: "border-success/30 bg-success-soft text-success-text",
    accentClass: "border-success/30 bg-success-soft/50",
  },
};

export function categoryStyle(category?: string): CategoryStyle {
  if (category && category in CATEGORY_STYLES) {
    return CATEGORY_STYLES[category as AnnouncementCategoryKey];
  }
  return CATEGORY_STYLES.notice;
}

export function formatRelativeNotificationTime(
  iso: string | undefined,
  lang: string,
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const locale = lang.replace("_", "-");
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (absSeconds < 60) return rtf.format(diffSeconds, "second");
    const diffMinutes = Math.round(diffSeconds / 60);
    if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, "minute");
    const diffHours = Math.round(diffMinutes / 60);
    if (Math.abs(diffHours) < 24) return rtf.format(diffHours, "hour");
    const diffDays = Math.round(diffHours / 24);
    if (Math.abs(diffDays) < 30) return rtf.format(diffDays, "day");
  } catch {
    // Fall back to absolute date formatting below.
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatFullNotificationTime(
  iso: string | undefined,
  lang: string,
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(lang.replace("_", "-"), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatPersonalMoney(
  data: Record<string, unknown>,
  lang: string,
): string | null {
  const amountCents = data.amountCents;
  const currency = data.currency;
  if (typeof amountCents !== "number" || !Number.isFinite(amountCents)) {
    return null;
  }
  const code = typeof currency === "string" && currency ? currency : "USD";
  try {
    return new Intl.NumberFormat(lang.replace("_", "-"), {
      style: "currency",
      currency: code,
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${code}`;
  }
}

export function personalNotificationIcon(kind: string): LucideIcon {
  if (kind === "referral_reward") return Gift;
  return Megaphone;
}

export type PersonalNotificationTranslationKey =
  | "notifications.personal.referralRewardTitle"
  | "notifications.personal.referralRewardBody"
  | "notifications.personal.referralRewardGeneric"
  | "notifications.personal.defaultTitle";

export function personalNotificationCopy(
  item: PersonalNotification,
  lang: string,
  t: (
    key: PersonalNotificationTranslationKey,
    options?: { amount: string },
  ) => string,
): { title: string; summary: string } {
  if (item.kind === "referral_reward") {
    const amount = formatPersonalMoney(item.data, lang);
    return {
      title: t("notifications.personal.referralRewardTitle"),
      summary: amount
        ? t("notifications.personal.referralRewardBody", { amount })
        : t("notifications.personal.referralRewardGeneric"),
    };
  }
  return {
    title: t("notifications.personal.defaultTitle"),
    summary: "",
  };
}
