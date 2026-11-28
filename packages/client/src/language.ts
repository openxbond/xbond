export const locales = ["en_US", "zh_CN", "zh_HK", "ko", "fa", "ru"] as const;

export type Lang = (typeof locales)[number];
