import type { AccountAnnouncement } from "@xbond/client/localapi";
import { atom } from "jotai";

export const notificationDrawerOpenAtom = atom(false);
export const selectedAnnouncementIdAtom = atom<string | null>(null);
export const dismissedBannersVersionAtom = atom(0);

const DISMISSED_BANNERS_PREFIX = "xbond.notifications.dismissedBanner.";
const SEEN_CRITICAL_PREFIX = "xbond.notifications.seenCritical.";
const CRITICAL_CATEGORIES = new Set(["security", "maintenance"]);

function safeStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Storage may be unavailable in restricted webviews.
  }
  return null;
}

export function isBannerDismissed(id: string): boolean {
  const storage = safeStorage();
  if (!storage) return false;
  return storage.getItem(`${DISMISSED_BANNERS_PREFIX}${id}`) === "1";
}

export function dismissBanner(id: string): void {
  const storage = safeStorage();
  if (!storage) return;
  storage.setItem(`${DISMISSED_BANNERS_PREFIX}${id}`, "1");
}

/**
 * Picks the highest-priority active banner that has not expired and has not
 * been locally dismissed by the user.
 */
export function pickActiveBanner(
  announcements: readonly AccountAnnouncement[] | undefined,
  isDismissed: (id: string) => boolean = isBannerDismissed,
  nowMs: number = Date.now(),
): AccountAnnouncement | null {
  if (!announcements?.length) return null;
  for (const item of announcements) {
    if (!item.isBanner) continue;
    if (isDismissed(item.id)) continue;
    if (item.bannerEndsAt) {
      const endsAt = Date.parse(item.bannerEndsAt);
      if (Number.isFinite(endsAt) && endsAt <= nowMs) continue;
    }
    return item;
  }
  return null;
}

export function loadSeenCriticalIds(accountKey: string): Set<string> {
  const storage = safeStorage();
  if (!storage || !accountKey) return new Set();
  try {
    const raw = storage.getItem(`${SEEN_CRITICAL_PREFIX}${accountKey}`);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

export function saveSeenCriticalIds(
  accountKey: string,
  ids: Iterable<string>,
): void {
  const storage = safeStorage();
  if (!storage || !accountKey) return;
  // Cap persisted IDs so localStorage stays tiny over years of releases.
  const list = Array.from(ids).slice(-200);
  storage.setItem(`${SEEN_CRITICAL_PREFIX}${accountKey}`, JSON.stringify(list));
}

/**
 * Returns newly-arrived unread critical (`security` / `maintenance`)
 * announcements that have not been seen before. When `baselineReady` is false
 * (initial boot or first fetch right after sign-in), it seeds `knownIds`
 * silently and returns [] so the user is never spammed with historical items.
 */
export function collectNewCriticalAnnouncements(options: {
  announcements: readonly AccountAnnouncement[] | undefined;
  knownIds: Set<string>;
  baselineReady: boolean;
}): AccountAnnouncement[] {
  const { announcements, knownIds, baselineReady } = options;
  if (!announcements?.length) return [];
  const critical = announcements.filter(
    (item) =>
      !item.readAt &&
      typeof item.category === "string" &&
      CRITICAL_CATEGORIES.has(item.category),
  );
  if (!baselineReady) {
    for (const item of announcements) {
      knownIds.add(item.id);
    }
    return [];
  }
  const fresh: AccountAnnouncement[] = [];
  for (const item of critical) {
    if (!knownIds.has(item.id)) {
      fresh.push(item);
    }
  }
  for (const item of announcements) {
    knownIds.add(item.id);
  }
  return fresh;
}
