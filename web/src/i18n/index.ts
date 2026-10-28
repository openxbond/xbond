import { type Infer } from "@lib/type";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { type IsEqual } from "type-fest";

import en_US from "./en_US";
import fa from "./fa";
import ko from "./ko";
import zh_CN from "./zh_CN";
import zh_HK from "./zh_HK";

export const locales = ["en_US", "zh_CN", "zh_HK", "ko", "fa"] as const;

export type Lang = (typeof locales)[number];

/** localStorage key shared with languageAtom in @stores. */
export const LANG_STORAGE_KEY = "language";

export function getDefaultLanguage(): Lang {
  for (const language of window.navigator.languages) {
    const l = language.toLowerCase();
    if (
      l.includes("hk") ||
      l.includes("mo") ||
      l.includes("tw") ||
      l.includes("hant")
    ) {
      return "zh_HK";
    } else if (l.includes("zh")) {
      return "zh_CN";
    } else if (l.includes("ko")) {
      return "ko";
    } else if (l.includes("fa") || l.includes("prs")) {
      return "fa";
    } else if (l.includes("us") || l.includes("en")) {
      return "en_US";
    }
  }
  return "en_US";
}

export function getStoredLanguage(): Lang {
  // languageAtom persists through jotai's JSON storage, so accept both the
  // quoted form it writes and a bare code.
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY);
    if (!raw) return getDefaultLanguage();
    let value: unknown = raw;
    try {
      value = JSON.parse(raw);
    } catch {
      // bare code — use as-is
    }
    if (
      typeof value === "string" &&
      (locales as readonly string[]).includes(value)
    ) {
      return value as Lang;
    }
  } catch {
    // localStorage can throw in privacy modes; fall through to detection.
  }
  return getDefaultLanguage();
}

// Shape parity: every locale must cover the same key paths as en_US,
// so a missing translation fails typecheck instead of rendering blank.
type KeyPaths = Infer<typeof en_US>;
type TrueGuard<T extends true> = T;
type _parityCN = TrueGuard<IsEqual<KeyPaths, Infer<typeof zh_CN>>>;
type _parityHK = TrueGuard<IsEqual<KeyPaths, Infer<typeof zh_HK>>>;
type _parityKO = TrueGuard<IsEqual<KeyPaths, Infer<typeof ko>>>;
type _parityFA = TrueGuard<IsEqual<KeyPaths, Infer<typeof fa>>>;

declare module "i18next" {
  interface CustomTypeOptions {
    resources: {
      common: typeof en_US.common;
      sidebar: typeof en_US.sidebar;
      overview: typeof en_US.overview;
      connect: typeof en_US.connect;
      proxies: typeof en_US.proxies;
      connections: typeof en_US.connections;
      logs: typeof en_US.logs;
      rules: typeof en_US.rules;
      diagnostics: typeof en_US.diagnostics;
      subscriptions: typeof en_US.subscriptions;
      settings: typeof en_US.settings;
      runtime: typeof en_US.runtime;
    };
  }
}

void i18next.use(initReactI18next).init({
  resources: {
    en_US: en_US,
    zh_CN: zh_CN,
    zh_HK: zh_HK,
    ko: ko,
    fa: fa,
  },
  lng: getStoredLanguage(),
  fallbackLng: "en_US",
  defaultNS: "common",
  // React escapes interpolated values itself.
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  parseMissingKeyHandler: (key) => {
    if (import.meta.env.DEV) {
      console.error(`[i18n] missing message: ${key}`);
    }
    return key;
  },
  react: { useSuspense: false },
});

export function setAppLanguage(lang: Lang) {
  void i18next.changeLanguage(lang);
}

export default i18next;
