import type {
  AccountAnnouncement,
  PersonalNotification,
} from "@xbond/client/localapi";
import { useAtom } from "jotai";
import {
  ArrowLeft,
  Bell,
  CheckCheck,
  CloudOff,
  ExternalLink,
  RefreshCw,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { openExternalUrl } from "@/platform/open-external";
import { useLanguage } from "@/state/user-preferences";

import { useAccount } from "../configuration/account/use-cloud-account";
import {
  categoryStyle,
  formatFullNotificationTime,
  formatRelativeNotificationTime,
  personalNotificationCopy,
  personalNotificationIcon,
} from "./announcement-meta";
import { NotificationMarkdown } from "./notification-markdown";
import {
  notificationDrawerOpenAtom,
  selectedAnnouncementIdAtom,
} from "./notification-state";

export function useNotificationActions() {
  const { t } = useTranslation("account");
  const { account, markAnnouncementRead, markPersonalRead, markAllRead } =
    useAccount();
  const [, setDrawerOpen] = useAtom(notificationDrawerOpenAtom);
  const [, setSelectedId] = useAtom(selectedAnnouncementIdAtom);

  function openList() {
    setSelectedId(null);
    setDrawerOpen(true);
  }

  function openAnnouncement(item: AccountAnnouncement) {
    setSelectedId(item.id);
    setDrawerOpen(true);
    if (!item.readAt) {
      void markAnnouncementRead(item.id).catch(() => {
        // Optimistic detail open stays responsive even when offline.
      });
    }
  }

  function openPersonal(item: PersonalNotification) {
    if (!item.readAt) {
      void markPersonalRead(item.id).catch(() => {
        toast.error(t("notifications.actionFailed"));
      });
    }
  }

  async function markAllAsRead() {
    if (!account || (account.unreadCount ?? 0) === 0) return;
    try {
      await markAllRead();
    } catch {
      toast.error(t("notifications.actionFailed"));
    }
  }

  return { openList, openAnnouncement, openPersonal, markAllAsRead };
}

export function NotificationDrawer() {
  const { t } = useTranslation("account");
  const { t: common } = useTranslation("common");
  const { lang } = useLanguage();
  const { account, syncOverview } = useAccount();
  const { openAnnouncement, openPersonal, markAllAsRead } =
    useNotificationActions();
  const [open, setOpen] = useAtom(notificationDrawerOpenAtom);
  const [selectedId, setSelectedId] = useAtom(selectedAnnouncementIdAtom);
  const [syncing, setSyncing] = useState(false);

  const signedIn = account?.status === "signed_in";
  const announcements = account?.announcements ?? [];
  const personal = account?.personal ?? [];
  const unreadCount = account?.unreadCount ?? 0;
  const selectedAnnouncement = selectedId
    ? (announcements.find((item) => item.id === selectedId) ?? null)
    : null;

  async function handleRefresh() {
    setSyncing(true);
    try {
      await syncOverview();
    } catch {
      toast.error(t("notifications.actionFailed"));
    } finally {
      setSyncing(false);
    }
  }

  function handleOpenConsole() {
    const url = account?.consoleUrl;
    if (!url) return;
    void openExternalUrl(url).catch(() => {
      toast.error(t("notifications.actionFailed"));
    });
  }

  return (
    <Sheet
      open={open && signedIn}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSelectedId(null);
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full max-w-full gap-0 border-0 p-0 sm:max-w-md sm:border-l"
      >
        {selectedAnnouncement ? (
          <DetailView
            item={selectedAnnouncement}
            lang={lang}
            consoleUrl={account?.consoleUrl}
            closeLabel={common("close")}
            onBack={() => setSelectedId(null)}
            onOpenConsole={handleOpenConsole}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <SheetHeader className="gap-1.5 border-b border-border bg-card px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 sm:px-5 sm:pt-4 sm:pb-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <SheetTitle className="truncate text-base">
                    {t("notifications.title")}
                  </SheetTitle>
                  {unreadCount > 0 && (
                    <Badge variant="secondary" className="tabular-nums">
                      {unreadCount}
                    </Badge>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 sm:size-8"
                    disabled={syncing}
                    aria-label={t("notifications.refresh")}
                    title={t("notifications.refresh")}
                    onClick={() => void handleRefresh()}
                  >
                    <RefreshCw
                      aria-hidden
                      className={cn(
                        "size-4 sm:size-3.5",
                        syncing && "animate-spin",
                      )}
                    />
                  </Button>
                  <DrawerCloseButton label={common("close")} />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                <SheetDescription className="min-w-0 text-xs leading-snug">
                  {t("notifications.subtitle")}
                </SheetDescription>
                {unreadCount > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-me-2 h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => void markAllAsRead()}
                  >
                    <CheckCheck aria-hidden className="size-3.5" />
                    {t("notifications.markAllRead")}
                  </Button>
                )}
              </div>
            </SheetHeader>

            {account?.overviewError && (
              <div className="flex items-center gap-2 border-b border-border bg-inset px-4 py-2 text-xs text-muted-foreground sm:px-5">
                <CloudOff aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">
                  {t("notifications.cachedNotice")}
                </span>
              </div>
            )}

            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto bg-inset/50 px-4 py-3 sm:bg-transparent",
                !account?.consoleUrl &&
                  "pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-3",
              )}
            >
              {announcements.length === 0 && personal.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-inset/50 px-6 py-12 text-center">
                  <Bell
                    aria-hidden
                    className="size-8 text-muted-foreground/60"
                  />
                  <p className="text-sm font-medium text-foreground">
                    {t("announcementsEmpty")}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("announcementsEmptyDesc")}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {personal.length > 0 && (
                    <section className="space-y-1.5">
                      <h3 className="px-1 text-xs font-semibold text-muted-foreground">
                        {t("notifications.personalSection")}
                      </h3>
                      <div className="space-y-1.5">
                        {personal.map((item) => {
                          const Icon = personalNotificationIcon(item.kind);
                          const copy = personalNotificationCopy(
                            item,
                            lang,
                            (k, opts) => t(k, opts),
                          );
                          const unread = !item.readAt;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => openPersonal(item)}
                              className={cn(
                                "flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-start transition-colors",
                                unread
                                  ? "border-brand/30 bg-brand/5 hover:bg-brand/10"
                                  : "border-border bg-card hover:bg-inset",
                              )}
                            >
                              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand-text">
                                <Icon aria-hidden className="size-4" />
                              </span>
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-sm font-medium text-foreground">
                                    {copy.title}
                                  </span>
                                  {unread && (
                                    <span
                                      aria-label={t(
                                        "notifications.unreadLabel",
                                      )}
                                      className="size-2 shrink-0 rounded-full bg-brand"
                                    />
                                  )}
                                </div>
                                {copy.summary && (
                                  <p className="text-xs text-muted-foreground">
                                    {copy.summary}
                                  </p>
                                )}
                                <p className="text-[11px] text-muted-foreground/80">
                                  {formatRelativeNotificationTime(
                                    item.createdAt,
                                    lang,
                                  )}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {announcements.length > 0 && (
                    <section className="space-y-1.5">
                      {personal.length > 0 && (
                        <h3 className="px-1 text-xs font-semibold text-muted-foreground">
                          {t("announcements")}
                        </h3>
                      )}
                      <div className="space-y-1.5">
                        {announcements.map((item) => {
                          const cat = categoryStyle(item.category);
                          const CatIcon = cat.Icon;
                          const unread = !item.readAt;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => openAnnouncement(item)}
                              className={cn(
                                "flex w-full flex-col gap-1.5 rounded-xl border px-3.5 py-3 text-start transition-colors",
                                unread
                                  ? "border-brand/30 bg-brand/5 hover:bg-brand/10"
                                  : "border-border bg-card hover:bg-inset",
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "gap-1 px-1.5 py-0 text-[10px]",
                                      cat.badgeClass,
                                    )}
                                  >
                                    <CatIcon aria-hidden className="size-2.5" />
                                    {t(`notifications.category.${cat.key}`)}
                                  </Badge>
                                  {item.tag && (
                                    <Badge
                                      variant="secondary"
                                      className="px-1.5 py-0 text-[10px]"
                                    >
                                      {item.tag}
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  {item.publishedAt && (
                                    <span className="text-[11px] text-muted-foreground">
                                      {formatRelativeNotificationTime(
                                        item.publishedAt,
                                        lang,
                                      )}
                                    </span>
                                  )}
                                  {unread && (
                                    <span
                                      aria-label={t(
                                        "notifications.unreadLabel",
                                      )}
                                      className="size-2 rounded-full bg-brand"
                                    />
                                  )}
                                </div>
                              </div>
                              <p className="text-sm font-semibold leading-snug text-foreground">
                                {item.title}
                              </p>
                              {item.summary && (
                                <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                  {item.summary}
                                </p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>

            {account?.consoleUrl && (
              <div className="border-t border-border bg-card px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-5 sm:py-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-10 w-full gap-1.5 sm:h-9"
                  onClick={handleOpenConsole}
                >
                  <ExternalLink aria-hidden className="size-3.5" />
                  {t("openConsole")}
                </Button>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerCloseButton({ label }: { label: string }) {
  return (
    <SheetClose asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 shrink-0 sm:size-8"
        aria-label={label}
        title={label}
      >
        <X aria-hidden className="size-4" />
      </Button>
    </SheetClose>
  );
}

function DetailView({
  item,
  lang,
  consoleUrl,
  closeLabel,
  onBack,
  onOpenConsole,
}: {
  item: AccountAnnouncement;
  lang: string;
  consoleUrl?: string;
  closeLabel: string;
  onBack: () => void;
  onOpenConsole: () => void;
}) {
  const { t } = useTranslation("account");
  const cat = categoryStyle(item.category);
  const CatIcon = cat.Icon;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="gap-1.5 border-b border-border bg-card px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3.5 sm:px-5 sm:pt-4 sm:pb-4">
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ms-2 h-9 gap-1 px-2 text-xs sm:h-8"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden className="size-3.5 rtl:rotate-180" />
            {t("notifications.backToList")}
          </Button>
          <DrawerCloseButton label={closeLabel} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn("gap-1 px-1.5 py-0 text-[11px]", cat.badgeClass)}
          >
            <CatIcon aria-hidden className="size-3" />
            {t(`notifications.category.${cat.key}`)}
          </Badge>
          {item.tag && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
              {item.tag}
            </Badge>
          )}
          {item.publishedAt && (
            <span className="text-xs text-muted-foreground">
              {formatFullNotificationTime(item.publishedAt, lang)}
            </span>
          )}
        </div>
        <SheetTitle className="mt-1 text-base leading-snug">
          {item.title}
        </SheetTitle>
        {item.summary && (
          <SheetDescription className="text-xs leading-relaxed">
            {item.summary}
          </SheetDescription>
        )}
      </SheetHeader>

      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5",
          !consoleUrl && "pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:pb-4",
        )}
      >
        {item.content?.trim() ? (
          <NotificationMarkdown content={item.content} />
        ) : item.summary ? (
          <p className="text-sm leading-relaxed text-foreground/90">
            {item.summary}
          </p>
        ) : null}
      </div>

      {consoleUrl && (
        <div className="border-t border-border bg-card px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-5 sm:py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 w-full gap-1.5 sm:h-9"
            onClick={onOpenConsole}
          >
            <ExternalLink aria-hidden className="size-3.5" />
            {t("openConsole")}
          </Button>
        </div>
      )}
    </div>
  );
}
