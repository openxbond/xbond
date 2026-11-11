export const locales = ["en_US", "zh_CN", "zh_HK", "ko", "fa"] as const;

export type Lang = (typeof locales)[number];
