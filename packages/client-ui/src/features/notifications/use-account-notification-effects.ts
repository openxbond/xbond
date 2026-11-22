import { subscriptionLang } from "@xbond/client/localapi";
import { useEffect, useEffectEvent, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { sendDesktopNotification } from "@/platform/notifications";
import { useLanguage } from "@/state/user-preferences";

import { useAccount } from "../configuration/account/use-cloud-account";
import { useNotificationActions } from "./notification-drawer";
import {
  collectNewCriticalAnnouncements,
  loadSeenCriticalIds,
  saveSeenCriticalIds,
} from "./notification-state";

const BACKGROUND_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const FOCUS_SYNC_COOLDOWN_MS = 60 * 1000;

/**
 * Coordinates signed-in Cloud account announcement side effects once at app root:
 * 1) Resyncs localized announcement copy whenever the UI language changes.
 * 2) Triggers throttled background/focus sync (15m interval, 60s cooldown).
 * 3) Dispatches non-intrusive critical (`security` / `maintenance`) alerts only
 *    for announcements that arrive AFTER an established session baseline.
 */
export function useAccountNotificationEffects(): void {
  const { t } = useTranslation("account");
  const { lang } = useLanguage();
  const { account, syncOverview } = useAccount();
  const { openAnnouncement } = useNotificationActions();

  const signedIn = account?.status === "signed_in";
  const accountKey = account?.email?.trim() || "default";
  const apiLang = subscriptionLang(lang);

  const lastLangRef = useRef<string | null>(null);
  const lastSyncAtRef = useRef<number>(0);
  const baselineAccountRef = useRef<string | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());

  const runThrottledSync = useEffectEvent((explicitLang?: string) => {
    if (!signedIn) return;
    const now = Date.now();
    if (now - lastSyncAtRef.current < FOCUS_SYNC_COOLDOWN_MS) return;
    lastSyncAtRef.current = now;
    void syncOverview(explicitLang).catch(() => {
      // Offline / transient network errors keep cached overview visible.
    });
  });

  // Reset baseline on sign-out, and notify only for newly-arrived critical items.
  useEffect(() => {
    if (!signedIn) {
      baselineAccountRef.current = null;
      knownIdsRef.current = new Set();
      lastLangRef.current = null;
      return;
    }

    const announcements = account?.announcements;
    if (!announcements) return;

    const baselineReady = baselineAccountRef.current === accountKey;
    if (!baselineReady) {
      knownIdsRef.current = loadSeenCriticalIds(accountKey);
      baselineAccountRef.current = accountKey;
    }

    const freshCritical = collectNewCriticalAnnouncements({
      announcements,
      knownIds: knownIdsRef.current,
      baselineReady,
    });
    saveSeenCriticalIds(accountKey, knownIdsRef.current);

    for (const item of freshCritical) {
      const body = item.summary?.trim() || "";
      void sendDesktopNotification(item.title, body);
      const notifyFn =
        item.category === "security" ? toast.error : toast.warning;
      notifyFn(item.title, {
        description: body || undefined,
        duration: 8000,
        action: {
          label: t("notifications.viewAction"),
          onClick: () => openAnnouncement(item),
        },
      });
    }
  }, [signedIn, accountKey, account?.announcements, openAnnouncement, t]);

  // Keep announcement language synced with active UI locale when signed in.
  useEffect(() => {
    if (!signedIn) return;
    if (lastLangRef.current === null) {
      lastLangRef.current = apiLang;
      return;
    }
    if (lastLangRef.current === apiLang) return;
    lastLangRef.current = apiLang;
    lastSyncAtRef.current = Date.now();
    void syncOverview(apiLang).catch(() => {
      // Cached overview stays intact when offline.
    });
  }, [signedIn, apiLang, syncOverview]);

  // Low-frequency periodic + focus/online background refresh while signed in.
  useEffect(() => {
    if (!signedIn) return;
    const timer = window.setInterval(
      () => runThrottledSync(),
      BACKGROUND_SYNC_INTERVAL_MS,
    );
    const onFocusOrOnline = () => runThrottledSync();
    window.addEventListener("focus", onFocusOrOnline);
    window.addEventListener("online", onFocusOrOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocusOrOnline);
      window.removeEventListener("online", onFocusOrOnline);
    };
  }, [signedIn]);
}
