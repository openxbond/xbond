// 扩展实际用到的 chrome.* API 最小面声明：跟随我们调用的形状走，不引入
// @types/chrome 的完整面。与官方类型有出入时以 MDN/Chromium 文档为准修正。

declare namespace chrome.proxy {
  type LevelOfControl =
    | "not_controllable"
    | "controlled_by_other_extensions"
    | "controllable_by_this_extension"
    | "controlled_by_this_extension";

  type SettingScope =
    | "regular"
    | "regular_only"
    | "incognito_persistent"
    | "incognito_session_only";

  type ProxyServer = {
    scheme?: "http" | "https" | "quic" | "socks4" | "socks5";
    host: string;
    port?: number;
  };

  type ProxyConfig = {
    mode: "direct" | "auto_detect" | "pac_script" | "fixed_servers" | "system";
    pacScript?: { url?: string; data?: string; mandatory?: boolean };
    rules?: {
      singleProxy?: ProxyServer;
      bypassList?: string[];
    };
  };

  type SettingDetails = {
    value?: ProxyConfig;
    scope?: SettingScope;
  };

  type SettingRead = {
    value?: ProxyConfig;
    levelOfControl: LevelOfControl;
  };

  namespace settings {
    function get(
      details: SettingDetails,
      callback: (result: SettingRead) => void,
    ): void;
    function set(details: SettingDetails, callback?: () => void): void;
    function clear(
      details: { scope?: SettingScope },
      callback?: () => void,
    ): void;
  }
}

declare namespace chrome.webRequest {
  type AuthChallengeResponse = {
    authCredentials?: { username: string; password: string };
    cancel?: boolean;
  };
  type AuthRequiredDetails = {
    requestId: number;
    isProxy: boolean;
    scheme: string;
    realm?: string;
    challenger: { host: string; port: number };
  };
  type OnAuthRequiredCallback = (
    details: AuthRequiredDetails,
    asyncCallback: (response?: AuthChallengeResponse) => void,
  ) => Promise<AuthChallengeResponse | undefined> | undefined;
  type OnAuthRequiredEvent = {
    addListener(
      callback: OnAuthRequiredCallback,
      filter?: { urls?: string[] },
      extraInfoSpec?: string[],
    ): void;
  };
  namespace onAuthRequired {
    const addListener: OnAuthRequiredEvent["addListener"];
  }
  namespace onErrorOccurred {
    type ErrorDetails = {
      requestId: number;
      url: string;
      error: string;
      fromProxy?: boolean;
    };
    type Event = {
      addListener(
        callback: (details: ErrorDetails) => void,
        filter?: { urls?: string[] },
      ): void;
    };
    const addListener: Event["addListener"];
  }
}

declare namespace chrome.storage {
  type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
  interface StorageArea {
    get(
      keys?: string | string[] | Record<string, unknown> | null,
      callback?: (items: Record<string, unknown>) => void,
    ): void;
    set(items: Record<string, unknown>, callback?: () => void): void;
    remove(keys: string | string[], callback?: () => void): void;
  }
  const local: StorageArea;
  const session: StorageArea;
  namespace onChanged {
    type Event = {
      addListener(callback: (changes: Changes, areaName: string) => void): void;
    };
    const addListener: Event["addListener"];
  }
}

declare namespace chrome.alarms {
  type Alarm = { name: string; scheduledTime: number };
  function create(
    name: string,
    info: { periodInMinutes?: number; delayInMinutes?: number; when?: number },
  ): void;
  function clear(name: string, callback?: (cleared: boolean) => void): void;
  namespace onAlarm {
    type Event = { addListener(callback: (alarm: Alarm) => void): void };
    const addListener: Event["addListener"];
  }
}

declare namespace chrome.runtime {
  function getURL(path: string): string;
  type InstalledDetails = {
    reason: "install" | "update" | "chrome_update" | "shared_module_update";
    previousVersion?: string;
  };
  namespace onInstalled {
    type Event = {
      addListener(callback: (details: InstalledDetails) => void): void;
    };
    const addListener: Event["addListener"];
  }
  namespace onStartup {
    type Event = { addListener(callback: () => void): void };
    const addListener: Event["addListener"];
  }
  function sendMessage(
    message: unknown,
    callback?: (response: unknown) => void,
  ): void;
  namespace onMessage {
    type Event = {
      addListener(
        callback: (
          message: unknown,
          sender: unknown,
          sendResponse: (response?: unknown) => void,
        ) => boolean | undefined,
      ): void;
    };
    const addListener: Event["addListener"];
  }
  const lastError: { message?: string } | undefined;
}

declare namespace chrome.tabs {
  function create(
    createProperties: { url: string; active?: boolean },
    callback?: (tab: unknown) => void,
  ): void;
}
