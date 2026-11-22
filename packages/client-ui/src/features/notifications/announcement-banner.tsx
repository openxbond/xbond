import { useAtom } from "jotai";
import { ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { useAccount } from "../configuration/account/use-cloud-account";
import { categoryStyle } from "./announcement-meta";
import { useNotificationActions } from "./notification-drawer";
import {
  dismissBanner,
  dismissedBannersVersionAtom,
  pickActiveBanner,
} from "./notification-state";

export function AnnouncementBanner({ className }: { className?: string }) {
  const { t } = useTranslation("account");
  const { account } = useAccount();
  const { openAnnouncement } = useNotificationActions();
  const [, bumpDismissed] = useAtom(dismissedBannersVersionAtom);

  if (account?.status !== "signed_in") return null;
  const banner = pickActiveBanner(account.announcements);
  if (!banner) return null;

  const cat = categoryStyle(banner.category);
  const CatIcon = cat.Icon;

  return (
    <div
      role="region"
      aria-label={t("announcements")}
      className={cn(
        "relative z-20 flex items-center gap-2.5 rounded-xl border px-3 py-2 text-xs shadow-2xs",
        cat.accentClass,
        className,
      )}
    >
      <button
        type="button"
        onClick={() => openAnnouncement(banner)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-start"
      >
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 gap-1 px-1.5 py-0 text-[10px]",
            cat.badgeClass,
          )}
        >
          <CatIcon aria-hidden className="size-3" />
          {t(`notifications.category.${cat.key}`)}
        </Badge>
        <span className="truncate font-medium text-foreground">
          {banner.title}
        </span>
        {banner.summary && (
          <span className="hidden truncate text-muted-foreground sm:inline">
            · {banner.summary}
          </span>
        )}
        <ChevronRight
          aria-hidden
          className="ms-auto size-3.5 shrink-0 text-muted-foreground rtl:rotate-180"
        />
      </button>
      <button
        type="button"
        aria-label={t("notifications.dismissBanner")}
        title={t("notifications.dismissBanner")}
        onClick={() => {
          dismissBanner(banner.id);
          bumpDismissed((v) => v + 1);
        }}
        className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}
