// 扩展界面文案（5 语言，键与 client-ui 的约定一致）：popup 与管理页共用。
// 文案刻意保持精简——扩展界面只有状态摘要与少量操作。

export const LOCALES = ["en_US", "zh_CN", "zh_HK", "ko", "fa"] as const;
export type Locale = (typeof LOCALES)[number];

const messages = {
  en_US: {
    productName: "XBond",
    proxy: "proxy",
    off: "off",
    on: "on",
    noConfig: "no config — sign in",
    signedOut: "signed out — sign in to fetch config",
    pendingLogin: "sign in: open the verification page",
    userCode: "code",
    authFailed: "auth failed",
    unreachable: "ingress unreachable",
    controlLost: "proxy control held by",
    invalidConfig: "invalid config",
    error: "error",
    manage: "manage",
    switchToGlobal: "switch to global",
    switchToRules: "switch to rules",
    signIn: "sign in",
    cancelLogin: "cancel",
    openVerification: "open verification page",
    waitingApproval: "waiting for approval…",
    logout: "sign out",
    manualIngress: "Manual ingress (probe / local agent)",
    host: "host",
    port: "port",
    credential: "proxy credential",
    apply: "apply config",
    diagnostics: "Diagnostics",
    noEvents: "no events yet",
    usage: "usage",
    expires: "renews",
  },
  zh_CN: {
    productName: "XBond",
    proxy: "代理",
    off: "关闭",
    on: "开启",
    noConfig: "还没有配置——请登录",
    signedOut: "未登录——登录后拉取配置",
    pendingLogin: "登录中：打开验证页面",
    userCode: "代码",
    authFailed: "认证失败",
    unreachable: "入口不可达",
    controlLost: "代理控制权在",
    invalidConfig: "配置无效",
    error: "错误",
    manage: "管理",
    switchToGlobal: "切换为全局",
    switchToRules: "切换为规则",
    signIn: "登录",
    cancelLogin: "取消",
    openVerification: "打开验证页面",
    waitingApproval: "等待批准…",
    logout: "退出登录",
    manualIngress: "手动入口（探针 / 本地代理）",
    host: "主机",
    port: "端口",
    credential: "代理凭据",
    apply: "应用配置",
    diagnostics: "诊断",
    noEvents: "暂无事件",
    usage: "用量",
    expires: "到期",
  },
  zh_HK: {
    productName: "XBond",
    proxy: "代理",
    off: "關閉",
    on: "開啟",
    noConfig: "還沒有配置——請登入",
    signedOut: "未登入——登入後拉取配置",
    pendingLogin: "登入中：打開驗證頁面",
    userCode: "代碼",
    authFailed: "認證失敗",
    unreachable: "入口不可達",
    controlLost: "代理控制權在",
    invalidConfig: "配置無效",
    error: "錯誤",
    manage: "管理",
    switchToGlobal: "切換為全域",
    switchToRules: "切換為規則",
    signIn: "登入",
    cancelLogin: "取消",
    openVerification: "打開驗證頁面",
    waitingApproval: "等待批准…",
    logout: "登出",
    manualIngress: "手動入口（探針 / 本地代理）",
    host: "主機",
    port: "連接埠",
    credential: "代理憑證",
    apply: "套用配置",
    diagnostics: "診斷",
    noEvents: "暫無事件",
    usage: "用量",
    expires: "到期",
  },
  ko: {
    productName: "XBond",
    proxy: "프록시",
    off: "꺼짐",
    on: "켜짐",
    noConfig: "구성 없음 — 로그인하세요",
    signedOut: "로그아웃됨 — 로그인 후 구성을 가져옵니다",
    pendingLogin: "로그인 중: 인증 페이지를 여세요",
    userCode: "코드",
    authFailed: "인증 실패",
    unreachable: "입구에 연결할 수 없음",
    controlLost: "프록시 제어권 보유:",
    invalidConfig: "구성이 잘못됨",
    error: "오류",
    manage: "관리",
    switchToGlobal: "전역으로 전환",
    switchToRules: "규칙으로 전환",
    signIn: "로그인",
    cancelLogin: "취소",
    openVerification: "인증 페이지 열기",
    waitingApproval: "승인 대기 중…",
    logout: "로그아웃",
    manualIngress: "수동 입구 (프로브 / 로컬 에이전트)",
    host: "호스트",
    port: "포트",
    credential: "프록시 자격 증명",
    apply: "구성 적용",
    diagnostics: "진단",
    noEvents: "이벤트 없음",
    usage: "사용량",
    expires: "갱신",
  },
  fa: {
    productName: "XBond",
    proxy: "پروکسی",
    off: "خاموش",
    on: "روشن",
    noConfig: "بدون پیکربندی — وارد شوید",
    signedOut: "خارج شده‌اید — برای دریافت پیکربندی وارد شوید",
    pendingLogin: "در حال ورود: صفحه تأیید را باز کنید",
    userCode: "کد",
    authFailed: "احراز هویت ناموفق",
    unreachable: "ورودی در دسترس نیست",
    controlLost: "کنترل پروکسی در دست:",
    invalidConfig: "پیکربندی نامعتبر",
    error: "خطا",
    manage: "مدیریت",
    switchToGlobal: "تغییر به سراسری",
    switchToRules: "تغییر به قانونی",
    signIn: "ورود",
    cancelLogin: "لغو",
    openVerification: "باز کردن صفحه تأیید",
    waitingApproval: "در انتظار تأیید…",
    logout: "خروج",
    manualIngress: "ورودی دستی (پروب / عامل محلی)",
    host: "میزبان",
    port: "درگاه",
    credential: "اعتبارنامه پروکسی",
    apply: "اعمال پیکربندی",
    diagnostics: "عیب‌یابی",
    noEvents: "رویدادی نیست",
    usage: "مصرف",
    expires: "تمدید",
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
