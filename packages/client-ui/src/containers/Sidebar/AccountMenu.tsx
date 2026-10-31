import { Modal } from "@components";
import AccountPanel from "@containers/AccountPanel";
import { useAccount } from "@stores";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import "./AccountMenu.scss";

/**
 * The avatar account entry, always visible in the sidebar footer (desktop
 * stacked controls; the slim row above the mobile bottom tabs). Opens the
 * XBond Cloud panel as a dialog.
 */
export function AccountMenu() {
  const { t } = useTranslation("account");
  const { account } = useAccount();
  const [open, setOpen] = useState(false);
  const signedIn = account?.status === "signed_in";
  const initial = (account?.name || account?.email || "?")
    .trim()
    .charAt(0)
    .toUpperCase();

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
