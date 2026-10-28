package i18n

type Messages struct {
	Lang string
	Dir  string

	// General Tags
	TagSuccess string
	TagInfo    string
	TagWarn    string
	TagError   string
	TagQuota   string

	// PKCE Login
	PkceTitleBanner    string
	OpeningBrowser     string
	BrowserOpenFailed  string
	VisitURLPrompt     string
	WaitingAuth        string
	HeadlessTokenHint  string
	AuthSuccess        string
	SubscriptionActive string
	QuotaUsage         string

	// Device Login
	DeviceTitleBanner string
	DeviceOpenBrowser string
	DeviceVisitPrompt string
	DeviceCodePrompt  string
	DeviceQuickLink   string
	DeviceWaiting     string
	DeviceApproved    string
	DeviceTimedOut    string
	DeviceDenied      string
	DeviceExpired     string

	// Engine Up / Down / Restart
	EngineStarted     string
	EngineStopped     string
	EngineRestarted   string
	PortConflictError string
	PortConflictHint  string

	// Status
	StatusTitle            string
	CoreReachability       string
	TrafficTakeover        string
	NetworkEgress          string
	StatusReadyCore        string
	StatusOfflineCore      string
	StatusActiveTakeover   string
	StatusDisabledTakeover string
	StatusVerifiedEgress   string
	StatusUnverifiedEgress string
	TakeoverModeLabel      string
	RoutingModeLabel       string
	LocalMixedPortLabel    string
	AllowLanLabel          string
	AllowLanTrue           string
	AllowLanFalse          string
	ActiveEgressChain      string
	ActiveSubLabel         string
	HealthStateLabel       string
	HealthOK               string
	QuotaUsageLabel        string
	ServiceExpireLabel     string
	NoActiveSub            string

	// Callback HTML fields
	PageTitle    string
	HtmlSubtitle string
	HtmlTitle    string
	HtmlDesc     string
	HtmlStatus   string
	HtmlMeta     string
	HtmlButton   string
	HtmlHint     string
}

var messagesMap = map[string]*Messages{
	"zh-HK": {
		Lang: "zh-HK",
		Dir:  "ltr",

		TagSuccess: "[成功]",
		TagInfo:    "[提示]",
		TagWarn:    "[警告]",
		TagError:   "[錯誤]",
		TagQuota:   "[配額]",

		PkceTitleBanner:    "  XBond 終端授權登入 (OAuth 2.0 PKCE)",
		OpeningBrowser:     "正在為你打開瀏覽器以完成登入與授權...",
		BrowserOpenFailed:  "無法自動打開系統瀏覽器: %v",
		VisitURLPrompt:     "請在瀏覽器中造訪以下鏈接以完成認證：",
		WaitingAuth:        "正在等待瀏覽器登入授權並自動獲取訂閱...",
		HeadlessTokenHint:  "(若在遠端或無圖形介面環境，亦可直接在此貼上你的 sub-* 憑據並按 Enter)",
		AuthSuccess:        "瀏覽器授權完成，已成功獲取訂閱憑據！",
		SubscriptionActive: "已成功登入並啟用訂閱: %s (%s)",
		QuotaUsage:         "流量已用: %.2f GB / %.2f GB (%.1f%%)",

		DeviceTitleBanner: "  XBond 設備授權登入 (OAuth 2.0 Device Authorization)",
		DeviceOpenBrowser: "正在嘗試為你打開瀏覽器以進行設備授權...",
		DeviceVisitPrompt: "請在任何已聯網且已登入 XBond 的瀏覽器（手機或電腦）中造訪：",
		DeviceCodePrompt:  "並輸入此設備的驗證碼：",
		DeviceQuickLink:   "或者直接點擊快捷授權鏈接：",
		DeviceWaiting:     "正在等待設備授權確認... (退出請按 Ctrl+C，亦可直接貼上 sub-* 憑據)",
		DeviceApproved:    "設備授權完成，已成功獲取訂閱憑據！",
		DeviceTimedOut:    "設備授權逾時 (%d 秒)，請重新執行 xbond login",
		DeviceDenied:      "授權請求已被用戶拒絕",
		DeviceExpired:     "設備授權碼已過期，請重新執行 xbond login",

		EngineStarted:     "XBond 核心已啟動 (模式: %s, 分流: %s, 端口: %d)",
		EngineStopped:     "XBond 核心已停止，系統代理已還原。",
		EngineRestarted:   "XBond 核心已重新載入運行配置。",
		PortConflictError: "端口 %d 已被本機其他程序佔用 (如 Clash、v2rayN 或 WSL/NAT)。",
		PortConflictHint:  "建議使用其他可用端口啟動，例如: xbond up --port 7891",

		StatusTitle:            "XBond 連線狀態 (Connection Status)",
		CoreReachability:       "1. 核心就緒 (Core Reachability):",
		TrafficTakeover:        "2. 流量接管 (Traffic Takeover):",
		NetworkEgress:          "3. 網絡出口 (Network Egress):",
		StatusReadyCore:        "已就緒 (核心運行中)",
		StatusOfflineCore:      "未運行 (OFFLINE)",
		StatusActiveTakeover:   "已啟用 (%s)",
		StatusDisabledTakeover: "未接管 (%s)",
		StatusVerifiedEgress:   "已驗證 (%d ms 延遲)",
		StatusUnverifiedEgress: "未驗證 (UNVERIFIED)",
		TakeoverModeLabel:      "接管模式:         ",
		RoutingModeLabel:       "分流模式:         ",
		LocalMixedPortLabel:    "本機混合端口:     ",
		AllowLanLabel:          "區域網路存取:     ",
		AllowLanTrue:           "開啟",
		AllowLanFalse:          "關閉",
		ActiveEgressChain:      "當前出口鏈路:     ",
		ActiveSubLabel:         "當前有效訂閱:     ",
		HealthStateLabel:       "健康狀態:         ",
		HealthOK:               "正常 (ok)",
		QuotaUsageLabel:        "配額用量:         ",
		ServiceExpireLabel:     "服務到期:         ",
		NoActiveSub:            "無有效訂閱 (請執行 'xbond login' 或 'xbond sub add')",

		PageTitle:    "XBond CLI 授權成功",
		HtmlSubtitle: "XBond 本機終端認證",
		HtmlTitle:    "授權成功",
		HtmlDesc:     "你的 XBond 訂閱憑據已自動同步至本地終端客戶端。",
		HtmlStatus:   "終端客戶端已就緒",
		HtmlMeta:     "OAuth 2.0 PKCE 憑據換取完成",
		HtmlButton:   "關閉此分頁",
		HtmlHint:     "你現在可以關閉瀏覽器，並返回終端開始使用。",
	},

	"zh-CN": {
		Lang: "zh-CN",
		Dir:  "ltr",

		TagSuccess: "[成功]",
		TagInfo:    "[提示]",
		TagWarn:    "[警告]",
		TagError:   "[错误]",
		TagQuota:   "[配额]",

		PkceTitleBanner:    "  XBond 终端授权登录 (OAuth 2.0 PKCE)",
		OpeningBrowser:     "正在为你打开浏览器以完成登录与授权...",
		BrowserOpenFailed:  "无法自动打开系统浏览器: %v",
		VisitURLPrompt:     "请在浏览器中访问以下链接以完成认证：",
		WaitingAuth:        "正在等待浏览器登录授权并自动获取订阅...",
		HeadlessTokenHint:  "(若在远程或无图形界面环境，亦可直接在此粘贴你的 sub-* 凭据并按 Enter)",
		AuthSuccess:        "浏览器授权完成，已成功获取订阅凭据！",
		SubscriptionActive: "已成功登录并激活订阅: %s (%s)",
		QuotaUsage:         "流量已用: %.2f GB / %.2f GB (%.1f%%)",

		DeviceTitleBanner: "  XBond 设备授权登录 (OAuth 2.0 Device Authorization)",
		DeviceOpenBrowser: "正在尝试为你打开浏览器以进行设备授权...",
		DeviceVisitPrompt: "请在任何已联网且已登录 XBond 的浏览器（手机或电脑）中访问：",
		DeviceCodePrompt:  "并输入此设备的验证码：",
		DeviceQuickLink:   "或者直接点击快捷授权链接：",
		DeviceWaiting:     "正在等待设备授权确认... (退出请按 Ctrl+C，亦可直接粘贴 sub-* 凭据)",
		DeviceApproved:    "设备授权完成，已成功获取订阅凭据！",
		DeviceTimedOut:    "设备授权超时 (%d 秒)，请重新运行 xbond login",
		DeviceDenied:      "授权请求已被用户拒绝",
		DeviceExpired:     "设备授权码已过期，请重新运行 xbond login",

		EngineStarted:     "XBond 核心已启动 (模式: %s, 分流: %s, 端口: %d)",
		EngineStopped:     "XBond 核心已停止，系统代理已还原。",
		EngineRestarted:   "XBond 核心已重新加载运行配置。",
		PortConflictError: "端口 %d 已被本机其他程序占用 (如 Clash、v2rayN 或 WSL/NAT)。",
		PortConflictHint:  "建议使用其他可用端口启动，例如: xbond up --port 7891",

		StatusTitle:            "XBond 连接状态 (Connection Status)",
		CoreReachability:       "1. 核心就绪 (Core Reachability):",
		TrafficTakeover:        "2. 流量接管 (Traffic Takeover):",
		NetworkEgress:          "3. 网络出口 (Network Egress):",
		StatusReadyCore:        "已就绪 (核心运行中)",
		StatusOfflineCore:      "未运行 (OFFLINE)",
		StatusActiveTakeover:   "已启用 (%s)",
		StatusDisabledTakeover: "未接管 (%s)",
		StatusVerifiedEgress:   "已验证 (%d ms 延迟)",
		StatusUnverifiedEgress: "未验证 (UNVERIFIED)",
		TakeoverModeLabel:      "接管模式:         ",
		RoutingModeLabel:       "分流模式:         ",
		LocalMixedPortLabel:    "本机混合端口:     ",
		AllowLanLabel:          "局域网访问:       ",
		AllowLanTrue:           "开启",
		AllowLanFalse:          "关闭",
		ActiveEgressChain:      "当前出口链路:     ",
		ActiveSubLabel:         "当前有效订阅:     ",
		HealthStateLabel:       "健康状态:         ",
		HealthOK:               "正常 (ok)",
		QuotaUsageLabel:        "配额用量:         ",
		ServiceExpireLabel:     "服务到期:         ",
		NoActiveSub:            "无有效订阅 (请运行 'xbond login' 或 'xbond sub add')",

		PageTitle:    "XBond CLI 授权成功",
		HtmlSubtitle: "XBond 本机终端认证",
		HtmlTitle:    "授权成功",
		HtmlDesc:     "你的 XBond 订阅凭据已自动同步至本地终端客户端。",
		HtmlStatus:   "终端客户端已就绪",
		HtmlMeta:     "OAuth 2.0 PKCE 凭据换取完成",
		HtmlButton:   "关闭此标签页",
		HtmlHint:     "你现在可以关闭浏览器，并返回终端开始使用。",
	},

	"en": {
		Lang: "en",
		Dir:  "ltr",

		TagSuccess: "[SUCCESS]",
		TagInfo:    "[INFO]",
		TagWarn:    "[WARN]",
		TagError:   "[ERROR]",
		TagQuota:   "[QUOTA]",

		PkceTitleBanner:    "  XBond Terminal Authorization (OAuth 2.0 PKCE)",
		OpeningBrowser:     "Opening browser to complete authorization...",
		BrowserOpenFailed:  "Failed to open browser automatically: %v",
		VisitURLPrompt:     "Please visit the following URL in your browser:",
		WaitingAuth:        "Waiting for browser authorization and subscription sync...",
		HeadlessTokenHint:  "(In remote or headless environments, paste your sub-* token here and press Enter)",
		AuthSuccess:        "Browser authorization completed, subscription token acquired!",
		SubscriptionActive: "Successfully logged in and activated subscription: %s (%s)",
		QuotaUsage:         "Data used: %.2f GB / %.2f GB (%.1f%%)",

		DeviceTitleBanner: "  XBond Device Authorization (OAuth 2.0 Device Flow)",
		DeviceOpenBrowser: "Opening browser for device authorization...",
		DeviceVisitPrompt: "Please visit the following URL on any connected browser:",
		DeviceCodePrompt:  "And enter the verification code:",
		DeviceQuickLink:   "Or open the quick authorization link:",
		DeviceWaiting:     "Waiting for device approval... (Ctrl+C to cancel, or paste sub-* token)",
		DeviceApproved:    "Device authorization completed, subscription token acquired!",
		DeviceTimedOut:    "Device authorization timed out after %d seconds, please try again",
		DeviceDenied:      "Authorization request was denied by the user",
		DeviceExpired:     "Device authorization code has expired, please run xbond login again",

		EngineStarted:     "XBond core started (mode: %s, routing: %s, port: %d)",
		EngineStopped:     "XBond core stopped, system proxy restored.",
		EngineRestarted:   "XBond core reloaded runtime configuration.",
		PortConflictError: "Port %d is already in use by another process (e.g. Clash, v2rayN, WSL/NAT).",
		PortConflictHint:  "Recommendation: Start with an available port, e.g.: xbond up --port 7891",

		StatusTitle:            "XBond Connection Status",
		CoreReachability:       "1. Core Reachability:  ",
		TrafficTakeover:        "2. Traffic Takeover:   ",
		NetworkEgress:          "3. Network Egress:     ",
		StatusReadyCore:        "READY (core running)",
		StatusOfflineCore:      "OFFLINE",
		StatusActiveTakeover:   "ACTIVE (%s)",
		StatusDisabledTakeover: "DISABLED (%s)",
		StatusVerifiedEgress:   "VERIFIED (%d ms latency)",
		StatusUnverifiedEgress: "UNVERIFIED",
		TakeoverModeLabel:      "Takeover Mode:         ",
		RoutingModeLabel:       "Routing Mode:          ",
		LocalMixedPortLabel:    "Local Mixed Port:      ",
		AllowLanLabel:          "Allow LAN Access:      ",
		AllowLanTrue:           "true",
		AllowLanFalse:          "false",
		ActiveEgressChain:      "Active Egress Chain:   ",
		ActiveSubLabel:         "Active Subscription:   ",
		HealthStateLabel:       "Health State:          ",
		HealthOK:               "ok",
		QuotaUsageLabel:        "Quota Usage:           ",
		ServiceExpireLabel:     "Service Expiration:    ",
		NoActiveSub:            "None configured (run 'xbond login' or 'xbond sub add')",

		PageTitle:    "XBond CLI Authorization Successful",
		HtmlSubtitle: "XBond Local Terminal Authentication",
		HtmlTitle:    "Authorization Successful",
		HtmlDesc:     "Your XBond subscription credentials have been synchronized to your local CLI.",
		HtmlStatus:   "Terminal client is ready",
		HtmlMeta:     "OAuth 2.0 PKCE token exchange completed",
		HtmlButton:   "Close This Tab",
		HtmlHint:     "You may now close this browser tab and return to your terminal.",
	},

	"ko": {
		Lang: "ko",
		Dir:  "ltr",

		TagSuccess: "[성공]",
		TagInfo:    "[안내]",
		TagWarn:    "[경고]",
		TagError:   "[오류]",
		TagQuota:   "[용량]",

		PkceTitleBanner:    "  XBond 터미널 인증 로그인 (OAuth 2.0 PKCE)",
		OpeningBrowser:     "로그인 및 인증을 위해 브라우저를 여는 중...",
		BrowserOpenFailed:  "시스템 브라우저를 열 수 없습니다: %v",
		VisitURLPrompt:     "인증을 완료하려면 브라우저에서 다음 링크를 방문하세요:",
		WaitingAuth:        "브라우저 로그인 인증 및 구독 동기화 대기 중...",
		HeadlessTokenHint:  "(원격 환경의 경우 sub-* 토큰을 여기에 직접 붙여넣고 Enter 키를 누르세요)",
		AuthSuccess:        "브라우저 인증이 완료되었으며 구독 토큰을 획득했습니다!",
		SubscriptionActive: "성공적으로 로그인되었으며 구독이 활성화되었습니다: %s (%s)",
		QuotaUsage:         "사용량: %.2f GB / %.2f GB (%.1f%%)",

		DeviceTitleBanner: "  XBond 기기 인증 로그인 (OAuth 2.0 Device Authorization)",
		DeviceOpenBrowser: "기기 인증을 위해 브라우저를 여는 중...",
		DeviceVisitPrompt: "인터넷에 연결된 브라우저(모바일 또는 PC)에서 다음 링크에 접속하세요:",
		DeviceCodePrompt:  "그리고 이 기기의 인증 코드를 입력하세요:",
		DeviceQuickLink:   "또는 빠른 인증 링크를 직접 클릭하세요:",
		DeviceWaiting:     "기기 승인 대기 중... (종료: Ctrl+C, sub-* 토큰 직접 입력 가능)",
		DeviceApproved:    "기기 인증이 완료되었으며 구독 토큰을 성공적으로 획득했습니다!",
		DeviceTimedOut:    "기기 인증 시간이 초과되었습니다 (%d초). 다시 시도해 주세요",
		DeviceDenied:      "사용자가 인증 요청을 거부했습니다",
		DeviceExpired:     "기기 인증 코드가 만료되었습니다. xbond login을 다시 실행하세요",

		EngineStarted:     "XBond 코어가 시작되었습니다 (모드: %s, 라우팅: %s, 포트: %d)",
		EngineStopped:     "XBond 코어가 중지되었으며 시스템 프록시가 복원되었습니다.",
		EngineRestarted:   "XBond 코어 설정이 다시 로드되었습니다.",
		PortConflictError: "포트 %d이(가) 다른 프로그램(Clash, v2rayN, WSL/NAT 등)에서 이미 사용 중입니다.",
		PortConflictHint:  "사용 가능한 다른 포트로 시작하세요. 예: xbond up --port 7891",

		StatusTitle:            "XBond 연결 상태 (Connection Status)",
		CoreReachability:       "1. 코어 상태 (Core Reachability):",
		TrafficTakeover:        "2. 트래픽 인계 (Traffic Takeover):",
		NetworkEgress:          "3. 네트워크 출구 (Network Egress):",
		StatusReadyCore:        "준비 완료 (코어 실행 중)",
		StatusOfflineCore:      "실행되지 않음 (OFFLINE)",
		StatusActiveTakeover:   "활성화 (%s)",
		StatusDisabledTakeover: "비활성화 (%s)",
		StatusVerifiedEgress:   "검증 완료 (%d ms 지연)",
		StatusUnverifiedEgress: "검증되지 않음 (UNVERIFIED)",
		TakeoverModeLabel:      "인계 모드:         ",
		RoutingModeLabel:       "라우팅 모드:       ",
		LocalMixedPortLabel:    "로컬 혼합 포트:   ",
		AllowLanLabel:          "로컬 네트워크 허용: ",
		AllowLanTrue:           "켜짐",
		AllowLanFalse:          "꺼짐",
		ActiveEgressChain:      "활성 출구 체인:   ",
		ActiveSubLabel:         "활성 구독:         ",
		HealthStateLabel:       "상태:             ",
		HealthOK:               "정상 (ok)",
		QuotaUsageLabel:        "용량 사용량:       ",
		ServiceExpireLabel:     "만료 일시:         ",
		NoActiveSub:            "구성된 구독 없음 ('xbond login' 또는 'xbond sub add' 실행)",

		PageTitle:    "XBond CLI 인증 성공",
		HtmlSubtitle: "XBond 로컬 터미널 인증",
		HtmlTitle:    "인증 성공",
		HtmlDesc:     "XBond 구독 자격 증명이 로컬 터미널 클라이언트에 자동으로 동기화되었습니다.",
		HtmlStatus:   "터미널 클라이언트 준비 완료",
		HtmlMeta:     "OAuth 2.0 PKCE 토큰 교환 완료",
		HtmlButton:   "이 탭 닫기",
		HtmlHint:     "이제 브라우저 탭을 닫고 터미널로 돌아가 사용할 수 있습니다.",
	},

	"fa": {
		Lang: "fa",
		Dir:  "rtl",

		TagSuccess: "[موفق]",
		TagInfo:    "[اطلاعات]",
		TagWarn:    "[هشدار]",
		TagError:   "[خطا]",
		TagQuota:   "[حجم]",

		PkceTitleBanner:    "  احراز هویت ترمینال XBond (OAuth 2.0 PKCE)",
		OpeningBrowser:     "در حال باز کردن مرورگر جهت ورود و احراز هویت...",
		BrowserOpenFailed:  "عدم موفقیت در باز کردن خودکار مرورگر: %v",
		VisitURLPrompt:     "لطفاً پیوند زیر را در مرورگر باز کنید:",
		WaitingAuth:        "در حال انتظار برای احراز هویت مرورگر و همگام‌سازی اشتراک...",
		HeadlessTokenHint:  "(در محیط سرور، می‌توانید توکن sub-* خود را مستقیماً اینجا وارد کنید)",
		AuthSuccess:        "احراز هویت مرورگر با موفقیت انجام شد!",
		SubscriptionActive: "ورود موفقیت‌آمیز و اشتراک فعال شد: %s (%s)",
		QuotaUsage:         "مصرف داده: %.2f گیگابایت / %.2f گیگابایت (%.1f%%)",

		DeviceTitleBanner: "  احراز هویت دستگاه XBond (OAuth 2.0 Device Flow)",
		DeviceOpenBrowser: "در حال باز کردن مرورگر جهت احراز هویت دستگاه...",
		DeviceVisitPrompt: "لطفاً در هر مرورگر متصل به اینترنت به نشانی زیر مراجعه کنید:",
		DeviceCodePrompt:  "و کد تأیید این دستگاه را وارد نمایید:",
		DeviceQuickLink:   "یا مستقیماً پیوند زیر را باز کنید:",
		DeviceWaiting:     "در حال انتظار برای تأیید دستگاه... (Ctrl+C برای خروج)",
		DeviceApproved:    "احراز هویت دستگاه با موفقیت انجام شد!",
		DeviceTimedOut:    "زمان احراز هویت دستگاه به پایان رسید (%d ثانیه)",
		DeviceDenied:      "درخواست احراز هویت توسط کاربر رد شد",
		DeviceExpired:     "کد دستگاه منقضی شده است، لطفاً دوباره امتحان کنید",

		EngineStarted:     "هسته XBond شروع به کار کرد (حالت: %s، مسیریابی: %s، درگاه: %d)",
		EngineStopped:     "هسته XBond متوقف شد و پراکسی سیستم بازیابی گردید.",
		EngineRestarted:   "پیکربندی XBond مجدداً بارگذاری شد.",
		PortConflictError: "درگاه %d توسط برنامه دیگری اشغال شده است.",
		PortConflictHint:  "پیشنهاد: با یک درگاه آزاد شروع کنید، مثلاً: xbond up --port 7891",

		StatusTitle:            "وضعیت اتصال XBond (Connection Status)",
		CoreReachability:       "۱. دسترسی به هسته:     ",
		TrafficTakeover:        "۲. هدایت ترافیک:       ",
		NetworkEgress:          "۳. خروجی شبکه:         ",
		StatusReadyCore:        "آماده (هسته در حال اجرا)",
		StatusOfflineCore:      "غیرفعال (OFFLINE)",
		StatusActiveTakeover:   "فعال (%s)",
		StatusDisabledTakeover: "غیرفعال (%s)",
		StatusVerifiedEgress:   "تأیید شده (%d میلی‌ثانیه تاخیر)",
		StatusUnverifiedEgress: "تأیید نشده (UNVERIFIED)",
		TakeoverModeLabel:      "حالت هدایت:            ",
		RoutingModeLabel:       "حالت مسیریابی:         ",
		LocalMixedPortLabel:    "درگاه محلی:            ",
		AllowLanLabel:          "دسترسی به شبکه محلی:   ",
		AllowLanTrue:           "فعال",
		AllowLanFalse:          "غیرفعال",
		ActiveEgressChain:      "مسیر خروجی فعال:       ",
		ActiveSubLabel:         "اشتراک فعال:           ",
		HealthStateLabel:       "وضعیت سلامت:           ",
		HealthOK:               "طبیعی (ok)",
		QuotaUsageLabel:        "مصرف حجم:              ",
		ServiceExpireLabel:     "انقضای سرویس:          ",
		NoActiveSub:            "هیچ اشتراک فعالی پیکربندی نشده است",

		PageTitle:    "احراز هویت XBond CLI با موفقیت انجام شد",
		HtmlSubtitle: "احراز هویت محلی XBond",
		HtmlTitle:    "احراز هویت موفقیت‌آمیز بود",
		HtmlDesc:     "اطلاعات اشتراک XBond شما به طور خودکار با کلاینت ترمینال محلی همگام‌سازی شد.",
		HtmlStatus:   "کلاینت ترمینال آماده است",
		HtmlMeta:     "مبادله توکن OAuth 2.0 PKCE انجام شد",
		HtmlButton:   "بستن این برگه",
		HtmlHint:     "اکنون می‌توانید این برگه را بسته و به ترمینال بازگردید.",
	},
}
