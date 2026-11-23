import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

import { useAccount } from "../configuration/account/use-cloud-account";
import { useNotificationActions } from "./notification-drawer";

export function NotificationBell({ className }: { className?: string }) {
  const { t } = useTranslation("account");
  const { account } = useAccount();
  const { openList } = useNotificationActions();

  if (account?.status !== "signed_in") return null;

  const unreadCount = account.unreadCount ?? 0;
  const badge =
    unreadCount > 9 ? "9+" : unreadCount > 0 ? String(unreadCount) : null;

  return (
    <button
      type="button"
      onClick={openList}
      aria-label={
        unreadCount > 0
          ? t("notifications.bellUnread", { count: unreadCount })
          : t("notifications.bellLabel")
      }
      title={t("notifications.title")}
      className={cn(
        "relative inline-flex size-8 cursor-pointer items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
        className,
      )}
    >
      <Bell aria-hidden className="size-4" strokeWidth={1.8} />
      {badge && (
        <span className="absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-action px-1 text-[10px] font-bold leading-none text-brand-action-foreground tabular-nums shadow-xs">
          {badge}
        </span>
      )}
    </button>
  );
}
