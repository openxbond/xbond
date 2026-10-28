import { type Lang } from "@i18n";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import "dayjs/locale/zh-hk";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

export function fromNow(date: Date, lang: Lang): string {
  const locale = lang === "en_US" ? "en" : lang === "zh_HK" ? "zh-hk" : "zh-cn";
  return dayjs(date).locale(locale).from(dayjs());
}
