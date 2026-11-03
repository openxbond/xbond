import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import AccountPanel from "@containers/AccountPanel";
import { useAccount } from "@stores";
import { cn } from "cn";
import { useState } from "react";
import { useTranslation } from "react-i18next";

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-70"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/**
 * The account entry. `row` renders the desktop sidebar footer row (icon,
 * identity caption and chevron); `avatar` renders the compact circular
 * button for the mobile top bar. Both open the XBond Cloud panel dialog.
 */
export function AccountMenu({
  variant = "row",
}: {
  variant?: "row" | "avatar";
}) {
  const { t } = useTranslation("account");
  const { t: tc } = useTranslation("common");
  const { account } = useAccount();
  const [open, setOpen] = useState(false);
  const signedIn = account?.status === "signed_in";
  const name = (account?.name || account?.email || "").trim();
  const initial = (account?.name || account?.email || "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  if (variant === "avatar") {
    return (
      <>
        <button
          type="button"
          className="relative inline-flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-sidebar-border bg-transparent text-sidebar-foreground-muted hover:border-sidebar-foreground-muted hover:text-foreground"
          aria-label={t("title")}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          {signedIn ? (
            <span
              className="text-sm font-semibold leading-none"
              aria-hidden="true"
            >
              {initial}
            </span>
          ) : (
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
            </svg>
          )}
          <span
            className={cn(
              "absolute right-[-1px] bottom-[-1px] size-[9px] rounded-full border-2 border-sidebar bg-muted",
              signedIn && "bg-success",
            )}
            aria-hidden="true"
          />
        </button>

        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!next) setOpen(false);
          }}
        >
          <DialogContent closeLabel={tc("close")} className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
            </DialogHeader>
            <AccountPanel />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-control bg-transparent px-2.5 py-2 text-left font-[inherit] text-sidebar-foreground-muted transition-colors duration-[120ms] ease-[var(--ease-out-expo)] hover:bg-sidebar-accent hover:text-sidebar-foreground motion-reduce:transition-none"
        aria-label={t("title")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span
          className="grid size-[30px] shrink-0 place-items-center rounded-full bg-sidebar-accent text-sidebar-foreground-muted"
          aria-hidden="true"
        >
          {signedIn ? (
            <span className="text-body font-semibold leading-none">
              {initial}
            </span>
          ) : (
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17.5 19a4.5 4.5 0 0 0 .38-8.98 6.5 6.5 0 0 0-12.6 1.74A4 4 0 0 0 6 19.94h11.5Z" />
            </svg>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span
            className="overflow-hidden text-ellipsis whitespace-nowrap text-body font-semibold text-sidebar-foreground"
            title={signedIn && name ? name : t("cloudAccount")}
          >
            {signedIn && name ? name : t("cloudAccount")}
          </span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-label text-sidebar-foreground-muted">
            {signedIn ? t("signedIn") : t("signedOut")}
          </span>
        </span>
        <Chevron />
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        <DialogContent closeLabel={tc("close")} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
          </DialogHeader>
          <AccountPanel />
        </DialogContent>
      </Dialog>
    </>
  );
}
