import { type Lang } from "@i18n";
import dayjs from "dayjs";
import "dayjs/locale/fa";
import "dayjs/locale/ko";
import "dayjs/locale/zh-cn";
import "dayjs/locale/zh-hk";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

const dayjsLocales = {
  en_US: "en",
  zh_CN: "zh-cn",
  zh_HK: "zh-hk",
  ko: "ko",
  fa: "fa",
} as const satisfies Record<Lang, string>;

export function fromNow(date: Date, lang: Lang): string {
  return dayjs(date).locale(dayjsLocales[lang]).from(dayjs());
}
