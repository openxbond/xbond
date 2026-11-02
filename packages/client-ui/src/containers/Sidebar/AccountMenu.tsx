import { Modal } from "@components";
import AccountPanel from "@containers/AccountPanel";
import { useAccount } from "@stores";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import "./AccountMenu.scss";

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
      className="account-row-chevron"
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
          className="account-avatar-btn"
          aria-label={t("title")}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          {signedIn ? (
            <span className="account-avatar-initial" aria-hidden="true">
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
            className={`account-avatar-state ${signedIn ? "is-signed-in" : ""}`}
            aria-hidden="true"
          />
        </button>

        <Modal
          className="account-dialog"
          show={open}
          title={t("title")}
          onClose={() => setOpen(false)}
          footer={false}
        >
          <AccountPanel />
        </Modal>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="account-row-btn"
        aria-label={t("title")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className="account-row-icon" aria-hidden="true">
          {signedIn ? (
            <span className="account-row-initial">{initial}</span>
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
        <span className="account-row-text">
          <span className="account-row-name">
            {signedIn && name ? name : t("cloudAccount")}
          </span>
          <span className="account-row-caption">
            {signedIn ? t("signedIn") : t("signedOut")}
          </span>
        </span>
        <Chevron />
      </button>

      <Modal
        className="account-dialog"
        show={open}
        title={t("title")}
        onClose={() => setOpen(false)}
        footer={false}
      >
        <AccountPanel />
      </Modal>
    </>
  );
}
