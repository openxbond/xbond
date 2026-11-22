import assert from "node:assert/strict";
import { test } from "node:test";

import { personalNotificationCopy } from "../src/features/notifications/announcement-meta.ts";
import {
  collectNewCriticalAnnouncements,
  pickActiveBanner,
} from "../src/features/notifications/notification-state.ts";

test("pickActiveBanner returns highest-priority non-expired, non-dismissed banner", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  const dismissed = new Set<string>(["dismissed-1"]);
  const announcements = [
    { id: "normal-1", title: "Normal", isBanner: false },
    { id: "dismissed-1", title: "Dismissed", isBanner: true },
    {
      id: "expired-1",
      title: "Expired",
      isBanner: true,
      bannerEndsAt: "2026-11-22T11:00:00Z",
    },
    {
      id: "active-1",
      title: "Active Maintenance",
      isBanner: true,
      bannerEndsAt: "2026-11-22T18:00:00Z",
    },
  ];
  const picked = pickActiveBanner(
    announcements,
    (id) => dismissed.has(id),
    now,
  );
  assert.equal(picked?.id, "active-1");
});

test("collectNewCriticalAnnouncements stays silent on initial baseline and alerts only on newly arrived security/maintenance", () => {
  const knownIds = new Set<string>();
  const initial = [
    { id: "sec-old", title: "Old Security", category: "security" },
    { id: "promo-1", title: "Promo", category: "promo" },
  ];

  // Baseline load: must not trigger notifications even if unread security alerts exist.
  const firstRun = collectNewCriticalAnnouncements({
    announcements: initial,
    knownIds,
    baselineReady: false,
  });
  assert.deepEqual(firstRun, []);
  assert.equal(knownIds.has("sec-old"), true);

  // Subsequent sync: new promo/notice or already-read critical stay quiet; new unread maintenance triggers.
  const secondRun = collectNewCriticalAnnouncements({
    announcements: [
      ...initial,
      { id: "promo-2", title: "New Promo", category: "promo" },
      { id: "notice-2", title: "New Notice", category: "notice" },
      {
        id: "maint-read",
        title: "Read Maint",
        category: "maintenance",
        readAt: "2026-11-22T11:00:00Z",
      },
      {
        id: "maint-new",
        title: "Scheduled Maintenance",
        category: "maintenance",
      },
    ],
    knownIds,
    baselineReady: true,
  });
  assert.deepEqual(
    secondRun.map((a) => a.id),
    ["maint-new"],
  );

  // Repeating the same snapshot never double-fires.
  const thirdRun = collectNewCriticalAnnouncements({
    announcements: [
      ...initial,
      {
        id: "maint-new",
        title: "Scheduled Maintenance",
        category: "maintenance",
      },
    ],
    knownIds,
    baselineReady: true,
  });
  assert.deepEqual(thirdRun, []);
});

test("personalNotificationCopy formats referral_reward currency cleanly", () => {
  const calls: Array<{ key: string; options?: Record<string, unknown> }> = [];
  const copy = personalNotificationCopy(
    {
      id: "per-1",
      kind: "referral_reward",
      data: { amountCents: 1250, currency: "USD" },
      createdAt: "2026-11-22T00:00:00Z",
    },
    "en_US",
    (key, options) => {
      calls.push({ key, options });
      return `${key}:${JSON.stringify(options ?? {})}`;
    },
  );
  assert.ok(copy.title.includes("notifications.personal.referralRewardTitle"));
  assert.ok(copy.summary.includes("$12.50"));
  assert.equal(calls.length, 2);
});
