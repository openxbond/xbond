// 扩展界面文案（5 语言）：popup 与管理页共用。文案刻意保持精简——扩展界面
// 只有状态摘要、订阅导入与节点/模式选择。

export const LOCALES = ["en_US", "zh_CN", "zh_HK", "ko", "fa"] as const;
export type Locale = (typeof LOCALES)[number];

const messages = {
  en_US: {
    productName: "XBond",
    proxy: "proxy",
    off: "off",
    on: "on",
    modeRule: "rule",
    modeGlobal: "global",
    modeDirect: "direct",
    noSubscription: "no subscription — paste a subscription link",
    authFailed: "auth failed",
    unreachable: "ingress unreachable",
    controlLost: "proxy control held by",
    invalidConfig: "invalid config",
    error: "error",
    manage: "manage",
    switchMode: "mode",
    nodes: "nodes",
    quota: "usage",
    expires: "renews",
    subscriptionLink: "subscription link",
    import: "import",
    importPlaceholder: "https://…/api/subscription/config?token=sub-…",
    refresh: "refresh",
    diagnostics: "Diagnostics",
    noEvents: "no events yet",
    selectNode: "node selection",
    groups: "strategy groups",
    currentExit: "current exit",
    direct: "DIRECT",
    reject: "REJECT",
  },
  zh_CN: {
    productName: "XBond",
    proxy: "代理",
    off: "关闭",
    on: "开启",
    modeRule: "规则",
    modeGlobal: "全局",
    modeDirect: "直连",
    noSubscription: "还没有订阅——粘贴订阅链接导入",
    authFailed: "认证失败",
    unreachable: "入口不可达",
    controlLost: "代理控制权在",
    invalidConfig: "配置无效",
    error: "错误",
    manage: "管理",
    switchMode: "模式",
    nodes: "节点",
    quota: "用量",
    expires: "到期",
    subscriptionLink: "订阅链接",
    import: "导入",
    importPlaceholder: "https://…/api/subscription/config?token=sub-…",
    refresh: "刷新",
    diagnostics: "诊断",
    noEvents: "暂无事件",
    selectNode: "节点选择",
    groups: "策略组",
    currentExit: "当前出口",
    direct: "直连",
    reject: "拦截",
  },
  zh_HK: {
    productName: "XBond",
    proxy: "代理",
    off: "關閉",
    on: "開啟",
    modeRule: "規則",
    modeGlobal: "全域",
    modeDirect: "直連",
    noSubscription: "還沒有訂閱——貼上訂閱連結導入",
    authFailed: "認證失敗",
    unreachable: "入口不可達",
    controlLost: "代理控制權在",
    invalidConfig: "配置無效",
    error: "錯誤",
    manage: "管理",
    switchMode: "模式",
    nodes: "節點",
    quota: "用量",
    expires: "到期",
    subscriptionLink: "訂閱連結",
    import: "導入",
    importPlaceholder: "https://…/api/subscription/config?token=sub-…",
    refresh: "重新整理",
    diagnostics: "診斷",
    noEvents: "暫無事件",
    selectNode: "節點選擇",
    groups: "策略組",
    currentExit: "目前出口",
    direct: "直連",
    reject: "攔截",
  },
  ko: {
    productName: "XBond",
    proxy: "프록시",
    off: "꺼짐",
    on: "켜짐",
    modeRule: "규칙",
    modeGlobal: "전역",
    modeDirect: "직접",
    noSubscription: "구독 없음 — 구독 링크를 붙여넣으세요",
    authFailed: "인증 실패",
    unreachable: "입구에 연결할 수 없음",
    controlLost: "프록시 제어권 보유:",
    invalidConfig: "구성이 잘못됨",
    error: "오류",
    manage: "관리",
    switchMode: "모드",
    nodes: "노드",
    quota: "사용량",
    expires: "갱신",
    subscriptionLink: "구독 링크",
    import: "가져오기",
    importPlaceholder: "https://…/api/subscription/config?token=sub-…",
    refresh: "새로고침",
    diagnostics: "진단",
    noEvents: "이벤트 없음",
    selectNode: "노드 선택",
    groups: "전략 그룹",
    currentExit: "현재 출구",
    direct: "직접",
    reject: "차단",
  },
  fa: {
    productName: "XBond",
    proxy: "پروکسی",
    off: "خاموش",
    on: "روشن",
    modeRule: "قانونی",
    modeGlobal: "سراسری",
    modeDirect: "مستقیم",
    noSubscription: "بدون اشتراک — پیوند اشتراک را بچسبانید",
    authFailed: "احراز هویت ناموفق",
    unreachable: "ورودی در دسترس نیست",
    controlLost: "کنترل پروکسی در دست:",
    invalidConfig: "پیکربندی نامعتبر",
    error: "خطا",
    manage: "مدیریت",
    switchMode: "حالت",
    nodes: "گره‌ها",
    quota: "مصرف",
    expires: "تمدید",
    subscriptionLink: "پیوند اشتراک",
    import: "ورود",
    importPlaceholder: "https://…/api/subscription/config?token=sub-…",
    refresh: "تازه‌سازی",
    diagnostics: "عیب‌یابی",
    noEvents: "رویدادی نیست",
    selectNode: "انتخاب گره",
    groups: "گروه‌های استراتژی",
    currentExit: "خروجی فعلی",
    direct: "مستقیم",
    reject: "مسدود",
  },
} as const;

export type MessageKey = keyof (typeof messages)["en_US"];

/** 从浏览器语言选字典：zh 分辨简繁，未知回落 en_US。 */
export function resolveLocale(tag: string | null | undefined): Locale {
  const lower = (tag ?? "").toLowerCase();
  if (
    lower.startsWith("zh-cn") ||
    lower.startsWith("zh-sg") ||
    lower.startsWith("zh-hans")
  )
    return "zh_CN";
  if (lower.startsWith("zh")) return "zh_HK";
  if (lower.startsWith("ko")) return "ko";
  if (lower.startsWith("fa")) return "fa";
  return "en_US";
}

export function t(locale: Locale, key: MessageKey): string {
  return messages[locale][key];
}

export function translator(
  tag: string | null | undefined,
): (key: MessageKey) => string {
  const locale = resolveLocale(tag);
  return (key) => t(locale, key);
}
