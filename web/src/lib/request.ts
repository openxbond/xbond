import axios, { type AxiosInstance } from "axios";

import type { CoreVersion } from "./capabilities";

export interface Config {
  port: number;
  "socks-port": number;
  "redir-port": number;
  "mixed-port": number;
  "allow-lan": boolean;
  mode: string;
  "log-level": string;
  "mode-list"?: string[];
}

export interface Rules {
  rules: Rule[] | null;
}

export interface Rule {
  type: string;
  payload: string;
  proxy: string;
}

export interface Proxies {
  proxies: Record<string, Proxy | Group>;
}

export interface Provider {
  name: string;
  proxies: Array<Group | Proxy>;
  type: "Proxy";
  vehicleType: "HTTP" | "File" | "Compatible";
  updatedAt?: string;
}

export interface RuleProvider {
  name: string;
  type: "Rule";
  vehicleType: "HTTP" | "File";
  behavior: string;
  ruleCount: number;
  updatedAt?: string;
}

export interface RuleProviders {
  providers: Record<string, RuleProvider>;
}

export interface ProxyProviders {
  providers: Record<string, Provider>;
}

interface History {
  time: string;
  delay: number;
  meanDelay?: number;
}

export interface Proxy {
  name: string;
  type:
    | "Direct"
    | "Reject"
    | "Shadowsocks"
    | "Vmess"
    | "Trojan"
    | "Socks"
    | "Http"
    | "Snell"
    | (string & {});
  history: History[];
  udp: boolean;
  alive?: boolean;
}

export interface Group {
  alive?: boolean;
  name: string;
  type: "Selector" | "URLTest" | "Fallback" | "LoadBalance";
  now: string;
  all: string[];
  history: History[];
}

export interface Snapshot {
  uploadTotal: number;
  downloadTotal: number;
  memory?: number;
  connections: Connections[];
}

export interface Connections {
  id: string;
  metadata: {
    network: string;
    type: string;
    host: string;
    processPath?: string;
    sourceIP: string;
    sourcePort: string;
    destinationPort: string;
    destinationIP?: string;
  };
  upload: number;
  download: number;
  start: string;
  chains: string[];
  rule: string;
  rulePayload: string;
}

export class Client {
  private static nextId = 0;
  readonly id = String(++Client.nextId);
  private static clients = new Map<string, Client>();
  static forController(url: string, secret: string) {
    const key = JSON.stringify([url, secret]);
    let client = this.clients.get(key);
    if (!client) {
      client = new Client(url, secret);
      this.clients.set(key, client);
      if (this.clients.size > 20)
        this.clients.delete(this.clients.keys().next().value!);
    }
    return client;
  }
  private readonly axiosClient: AxiosInstance;

  constructor(url: string, secret?: string) {
    this.axiosClient = axios.create({
      baseURL: `${url.replace(/\/+$/, "")}/`,
      timeout: 15000,
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
  }

  async getConfig() {
    return await this.axiosClient.get<Config>("configs");
  }

  async updateConfig(config: Partial<Config>) {
    return await this.axiosClient.patch<void>("configs", config);
  }

  async getRules() {
    return await this.axiosClient.get<Rules>("rules");
  }

  async getProxyProviders() {
    const resp = await this.axiosClient.get<ProxyProviders>(
      "providers/proxies",
      {
        validateStatus(status) {
          // compatible old version
          return (status >= 200 && status < 300) || status === 404;
        },
      },
    );
    if (resp.status === 404) {
      resp.data = { providers: {} };
    }
    return resp;
  }

  async getRuleProviders() {
    return await this.axiosClient.get<RuleProviders>("providers/rules");
  }

  async updateProvider(name: string) {
    return await this.axiosClient.put<void>(
      `providers/proxies/${encodeURIComponent(name)}`,
    );
  }

  async updateRuleProvider(name: string) {
    return await this.axiosClient.put<void>(
      `providers/rules/${encodeURIComponent(name)}`,
    );
  }

  async healthCheckProvider(name: string) {
    return await this.axiosClient.get<void>(
      `providers/proxies/${encodeURIComponent(name)}/healthcheck`,
    );
  }

  async getProxies() {
    return await this.axiosClient.get<Proxies>("proxies");
  }

  async getProxy(name: string) {
    return await this.axiosClient.get<Proxy>(
      `proxies/${encodeURIComponent(name)}`,
    );
  }

  async getVersion() {
    return await this.axiosClient.get<CoreVersion>("version");
  }

  async getProxyDelay(
    name: string,
    url = "https://www.gstatic.com/generate_204",
    timeout = 5000,
    signal?: AbortSignal,
  ) {
    return await this.axiosClient.get<{ delay: number }>(
      `proxies/${encodeURIComponent(name)}/delay`,
      {
        params: {
          timeout,
          url,
        },
        timeout: timeout + 2000,
        signal,
      },
    );
  }

  async closeAllConnections() {
    return await this.axiosClient.delete("connections");
  }

  async closeConnection(id: string) {
    return await this.axiosClient.delete(`connections/${id}`);
  }

  async getConnections() {
    return await this.axiosClient.get<Snapshot>("connections");
  }

  async changeProxySelected(name: string, select: string) {
    return await this.axiosClient.put<void>(
      `proxies/${encodeURIComponent(name)}`,
      { name: select },
    );
  }

  async queryDNS(name: string, type: string) {
    return await this.axiosClient.get<DNSResult>("dns/query", {
      params: { name, type },
    });
  }
  async flushCache(type: "dns" | "fakeip") {
    return await this.axiosClient.post<void>(`cache/${type}/flush`);
  }
  async reloadConfig() {
    return await this.axiosClient.put<void>("configs", {});
  }
}

export interface DNSRecord {
  name: string;
  type: number;
  TTL: number;
  data: string;
}
export interface DNSResult {
  Status: number;
  Answer?: DNSRecord[];
  Authority?: DNSRecord[];
  Additional?: DNSRecord[];
}
