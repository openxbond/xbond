import { type Infer } from "@lib/type";
import { type IsEqual } from "type-fest";

import en_US from "./en_US";
import zh_CN from "./zh_CN";
import zh_HK from "./zh_HK";

export const Language = {
  en_US,
  zh_CN,
  zh_HK,
};

export type Lang = keyof typeof Language;

type US = typeof Language.en_US;
type CN = typeof Language.zh_CN;
type HK = typeof Language.zh_HK;

// type guard for US, CN, and HK
type TrueGuard<T extends true> = T;
type _equalGuard = TrueGuard<IsEqual<Infer<US>, Infer<CN>>>;
type _equalGuardHK = TrueGuard<IsEqual<Infer<US>, Infer<HK>>>;

export type LocalizedType = US;

export const locales = Object.keys(Language);

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
    } else if (l.includes("us") || l.includes("en")) {
      return "en_US";
    }
  }

  return "en_US";
}
