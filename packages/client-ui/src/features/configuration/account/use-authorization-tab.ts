import type { AccountStatus } from "@xbond/client/localapi";
import { useEffect, useRef } from "react";

import { hasAndroidBridge } from "@/platform/android-bridge";
import { isTauriRuntime } from "@/platform/host";

export function useAuthorizationTab(account: AccountStatus | null) {
  const tab = useRef<Window | null>(null);
  const authorizationURL =
    account?.authUrl ||
    account?.verificationUriComplete ||
    account?.verificationUri;

  function close() {
    const pending = tab.current;
    tab.current = null;
    pending?.close();
  }

  function open(message: string) {
    if (isTauriRuntime() || hasAndroidBridge()) return;
    close();
    const pending = window.open("about:blank", "_blank");
    if (!pending) return;
    tab.current = pending;
    pending.opener = null;

    const page = pending.document;
    page.title = message;
    page.documentElement.lang = document.documentElement.lang;
    page.documentElement.dir = document.documentElement.dir;
    page.documentElement.style.colorScheme =
      document.documentElement.classList.contains("dark") ? "dark" : "light";
    const status = page.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = message;
    page.body.style.cssText =
      "font: 1rem system-ui; margin: 0; padding: 1.5rem; min-height: 80vh; display: grid; place-items: center; text-align: center";
    page.body.replaceChildren(status);
  }

  const status = account?.status;
  useEffect(() => {
    const pending = tab.current;
    if (!pending) return;
    if (status === "pending" && authorizationURL) {
      tab.current = null;
      if (!pending.closed) pending.location.replace(authorizationURL);
    } else if (status === "error" || status === "signed_in") {
      tab.current = null;
      pending.close();
    }
  }, [status, authorizationURL]);

  useEffect(
    () => () => {
      tab.current?.close();
      tab.current = null;
    },
    [],
  );

  return { authorizationURL, open, close };
}
