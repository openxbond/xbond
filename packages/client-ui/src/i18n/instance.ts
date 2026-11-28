import { locales, type Lang } from "@xbond/client/language";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { type IsEqual } from "type-fest";

import { type Infer } from "./message-key-paths";
import en_US from "./messages/en-us";
import fa from "./messages/fa";
import ko from "./messages/ko";
import ru from "./messages/ru";
import zh_CN from "./messages/zh-cn";
import zh_HK from "./messages/zh-hk";

export { locales, type Lang } from "@xbond/client/language";

/** localStorage key shared with the language preference atom. */
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
    } else if (l.includes("ru")) {
      return "ru";
    } else if (l.includes("us") || l.includes("en")) {
      return "en_US";
    }
  }
  return "zh_HK";
}

function getStoredLanguage(): Lang {
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

// Shape parity: every locale must cover the same key paths as zh_HK,
// so a missing translation fails typecheck instead of rendering blank.
type KeyPaths = Infer<typeof zh_HK>;
type TrueGuard<T extends true> = T;
type _parityEN = TrueGuard<IsEqual<KeyPaths, Infer<typeof en_US>>>;
type _parityCN = TrueGuard<IsEqual<KeyPaths, Infer<typeof zh_CN>>>;
type _parityKO = TrueGuard<IsEqual<KeyPaths, Infer<typeof ko>>>;
type _parityFA = TrueGuard<IsEqual<KeyPaths, Infer<typeof fa>>>;
type _parityRU = TrueGuard<IsEqual<KeyPaths, Infer<typeof ru>>>;

declare module "i18next" {
  interface CustomTypeOptions {
    resources: {
      common: typeof zh_HK.common;
      titlebar: typeof zh_HK.titlebar;
      sidebar: typeof zh_HK.sidebar;
      overview: typeof zh_HK.overview;
      connect: typeof zh_HK.connect;
      proxies: typeof zh_HK.proxies;
      connections: typeof zh_HK.connections;
      logs: typeof zh_HK.logs;
      rules: typeof zh_HK.rules;
      diagnostics: typeof zh_HK.diagnostics;
      subscriptions: typeof zh_HK.subscriptions;
      settings: typeof zh_HK.settings;
      runtime: typeof zh_HK.runtime;
      onboarding: typeof zh_HK.onboarding;
      account: typeof zh_HK.account;
      configuration: typeof zh_HK.configuration;
      commandPalette: typeof zh_HK.commandPalette;
    };
  }
}

void i18next.use(initReactI18next).init({
  resources: {
    zh_HK: zh_HK,
    zh_CN: zh_CN,
    en_US: en_US,
    ko: ko,
    fa: fa,
    ru: ru,
  },
  lng: getStoredLanguage(),
  fallbackLng: "zh_HK",
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
  // The document language and direction follow the interface language, so
  // screen readers and the Persian RTL layout stop inheriting the host's.
  const intl = {
    en_US: "en",
    zh_CN: "zh-CN",
    zh_HK: "zh-HK",
    ko: "ko",
    fa: "fa",
    ru: "ru",
  } satisfies Record<Lang, string>;
  document.documentElement.lang = intl[lang];
  // The shell is composed LTR (fixed rail, physical margins), so Persian
  // keeps Unicode bidi inside an LTR frame until the layout migrates to
  // logical properties.
  document.documentElement.dir = "ltr";
  void i18next.changeLanguage(lang);
}

export default i18next;
