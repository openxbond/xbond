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
    noSubscription: "signed in — no config yet; refresh or sign in again",
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
    signIn: "sign in",
    cancelLogin: "cancel",
    waitingApproval: "waiting for approval",
    userCode: "code",
    openVerification: "open verification page",
    logout: "sign out",
    refresh: "refresh config",
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
    noSubscription: "已登录但还没有配置——刷新或重新登录",
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
    signIn: "登录",
    cancelLogin: "取消",
    waitingApproval: "等待批准",
    userCode: "代码",
    openVerification: "打开验证页面",
    logout: "退出登录",
    refresh: "刷新配置",
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
    noSubscription: "已登入但還沒有配置——重新整理或重新登入",
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
    signIn: "登入",
    cancelLogin: "取消",
    waitingApproval: "等待批准",
    userCode: "代碼",
    openVerification: "打開驗證頁面",
    logout: "登出",
    refresh: "重新整理配置",
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
    noSubscription:
      "로그인됨 — 구성이 없습니다. 새로고침하거나 다시 로그인하세요",
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
    signIn: "로그인",
    cancelLogin: "취소",
    waitingApproval: "승인 대기 중",
    userCode: "코드",
    openVerification: "인증 페이지 열기",
    logout: "로그아웃",
    refresh: "구성 새로고침",
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
    noSubscription: "وارد شده‌اید اما پیکربندی نیست — تازه‌سازی یا ورود دوباره",
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
    signIn: "ورود",
    cancelLogin: "لغو",
    waitingApproval: "در انتظار تأیید",
    userCode: "کد",
    openVerification: "باز کردن صفحه تأیید",
    logout: "خروج",
    refresh: "تازه‌سازی پیکربندی",
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
