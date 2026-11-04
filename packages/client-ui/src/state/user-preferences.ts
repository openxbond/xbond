import { produce } from "immer";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useCallback, useEffect } from "react";

import {
  useWarpImmerSetter,
  type WritableDraft,
} from "@/hooks/use-immer-draft-setter";
import {
  LANG_STORAGE_KEY,
  locales,
  type Lang,
  getDefaultLanguage,
  setAppLanguage,
} from "@/i18n/instance";

export const languageAtom = atomWithStorage<Lang | undefined>(
  LANG_STORAGE_KEY,
  undefined,
);

export type ThemePreference = "light" | "dark" | "system";

export const themeAtom = atomWithStorage<ThemePreference | undefined>(
  "theme",
  undefined,
);

export interface DesktopPreferences {
  autostart: boolean;
  closeToTray: boolean;
}

export const desktopPreferencesAtom = atomWithStorage<DesktopPreferences>(
  "desktop_preferences",
  {
    autostart: false,
    closeToTray: true,
  },
);

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function resolveDark(pref: ThemePreference | undefined) {
  if (pref === "light") return false;
  if (pref === "dark") return true;
  return darkQuery.matches;
}

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  // Browsers refuse a theme-color they cannot parse — hex, not oklch.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#0a0a0a" : "#f7f7f7");
}

/**
 * Applies the theme preference to <html>. index.html carries the same
 * resolution inline as an anti-flash script, so this only handles runtime
 * changes: preference switches and the system theme following along.
 */
export function useTheme() {
  const [theme] = useAtom(themeAtom);

  useEffect(() => {
    applyTheme(resolveDark(theme));
    if (theme === "light" || theme === "dark") return;

    const onChange = () => applyTheme(darkQuery.matches);
    darkQuery.addEventListener("change", onChange);
    return () => darkQuery.removeEventListener("change", onChange);
  }, [theme]);

  return theme;
}

/**
 * Language preference. The persisted atom stays the single source of
 * truth for the setting; the i18next instance follows it so every
 * useTranslation() re-renders on change.
 */
export function useLanguage() {
  const [stored, setLang] = useAtom(languageAtom);
  const lang = stored ?? getDefaultLanguage();

  useEffect(() => {
    setAppLanguage(lang);
  }, [lang]);

  return { lang, locales, setLang };
}

export const configAtom = atomWithStorage("profile", {
  breakConnections: false,
  logLevel: "",
  testURL: "https://www.gstatic.com/generate_204",
  testTimeout: 5000,
});
export function useConfig() {
  const [data, set] = useAtom(configAtom);
  const setter = useCallback(
    (f: WritableDraft<typeof data>) => {
      set(produce(data, f));
    },
    [data, set],
  );
  return { data, set: useWarpImmerSetter(setter) };
}

export const pinnedNodesAtom = atomWithStorage<string[]>("pinned_nodes", []);

export function usePinnedNodes() {
  const [pinned, setPinned] = useAtom(pinnedNodesAtom);

  const togglePin = useCallback(
    (nodeName: string) => {
      setPinned((prev) =>
        prev.includes(nodeName)
          ? prev.filter((name) => name !== nodeName)
          : [...prev, nodeName],
      );
    },
    [setPinned],
  );

  const isPinned = useCallback(
    (nodeName: string) => pinned.includes(nodeName),
    [pinned],
  );

  return { pinned, togglePin, isPinned };
}
